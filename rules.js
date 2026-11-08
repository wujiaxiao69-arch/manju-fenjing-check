/**
 * Rule engine for the AI storyboard quality checker.
 *
 * Deterministic, dependency-free: given one storyboard segment as markdown,
 * walk the eight checks and return graded findings. No model call, no network.
 *
 * @module rules
 */

const SHOT_HEADING = /^###\s*镜头\s*(\d+)\s*$/gm

/** Sensitive terms that routinely trip platform review. */
export const SENSITIVE_TERMS = [
  '血', '死', '尸', '残', '匪', '刀', '杀', '伤口', '赤脚', '赤足',
  '半张脸', '瘦', '饿', '疼', '裂', '断口', '痂', '肿', '撞', '疤',
]

/** Words that describe what a character looks like rather than what they do. */
const APPEARANCE_TERMS = [
  '肩很宽', '肩膀很宽', '肩宽', '背很直', '身材', '个头', '个子高', '个子矮',
  '年纪', '多岁', '岁数', '穿着', '衣着', '洗得发白', '皮肤', '发髻', '胡茬',
  '颧骨', '眉毛', '五官', '长得很',
]

/** Modern objects that break a period setting. */
const MODERN_TERMS = [
  '不锈钢', '不粘锅', '平底锅', '铝锅', '铝盆', '搪瓷', '瓷砖', '玻璃', '塑料',
  '霓虹', '公分', '厘米', '锤纹', '电磁炉', '煤气', '自来水龙头',
]

/** Hands and partial faces welded into a prop or plate image. */
const BODY_PART_TERMS = ['手', '指尖', '指节', '掌心', '手掌', '下颌', '嘴角', '半张脸', '下巴']

/** Words that hint at a character knowing more than they should. */
const OMEN_TERMS = ['前世', '上辈子', '穿越', '重生', '命中注定', '多年以后', '多年后', '将来会', '以后的日']

/** Strip punctuation so character counting reflects spoken length. */
function spokenChars(text) {
  if (!text) return 0
  const cjk = text.match(/[\u4e00-\u9fa5]/g) || []
  const words = text.match(/[A-Za-z0-9]+/g) || []
  return cjk.length + words.length
}

/** Pull the field lines of one shot block into a map. */
function parseFields(block) {
  const fields = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*-\s*\*\*(.+?)\*\*[：:]\s*(.*)$/)
    if (m) fields[m[1].trim()] = m[2].trim()
  }
  return fields
}

/** Parse every `### 镜头 N` block. */
function parseShots(text) {
  const marks = [...text.matchAll(SHOT_HEADING)]
  return marks.map((m, i) => {
    const start = m.index
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const body = text.slice(start, end)
    return { no: Number(m[1]), body, fields: parseFields(body) }
  })
}

/** Split a file that holds several segments into per-segment chunks. */
function splitSegments(text) {
  const marks = [...text.matchAll(/^#\s+.+$/gm)]
  if (marks.length <= 1) return [text]
  return marks.map((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    return text.slice(m.index, end)
  })
}

/** Collect `@图N` references declared in the image-prompt section. */
function parseRefs(text) {
  const refs = new Map()
  for (const line of text.split('\n')) {
    const m = line.match(/^@图(\d+)\s+(.+)$/)
    if (!m) continue
    const no = Number(m[1])
    const rest = m[2].trim()
    const name = rest.split(/[（(]/)[0].trim()
    refs.set(no, {
      no,
      name,
      line: rest,
      baseline: /你传|基准图/.test(rest),
      tailFrame: /尾帧|上一段|上一镜/.test(rest),
      generated: /我出/.test(rest),
      backOnly: /背对|背影|只给背/.test(rest),
    })
  }
  return refs
}

/** Per-shot durations, from the first source that yields a full set. */
function parseDurations(text, shotCount) {
  // 1) overview table rows: | 3 | 1.8 | 特写 | ...
  const rows = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|/)
    if (m) rows.push([Number(m[1]), Number(m[2])])
  }
  if (rows.length) {
    return new Map(rows.filter(([no, sec]) => no >= 1 && no <= shotCount && Number.isFinite(sec)))
  }
  // 2) explicit timecode fields, one per shot, in shot order
  const timecodes = [...text.matchAll(/\*\*时间码\*\*[：:]\s*([\d.]+)\s*[–\-~]\s*([\d.]+)/g)]
  if (timecodes.length) {
    return new Map(timecodes.map((m, i) => [i + 1, Number((Number(m[2]) - Number(m[1])).toFixed(2))]))
  }
  // 3) timeline block lines: 0.0–1.4 中景｜...
  const timeline = [...text.matchAll(/^([\d.]+)\s*[–\-]\s*([\d.]+)\s+\S*｜/gm)]
  if (timeline.length) {
    return new Map(timeline.map((m, i) => [i + 1, Number((Number(m[2]) - Number(m[1])).toFixed(2))]))
  }
  return new Map()
}

/** Declared totals from the header blockquote. */
function parseHeader(text) {
  const seconds = text.match(/^>\s*([\d.]+)\s*秒/m)
  const shots = text.match(/\/\s*(\d+)\s*镜/)
  const chars = text.match(/台词\s*(\d+)\s*字/)
  return {
    seconds: seconds ? Number(seconds[1]) : null,
    shotCount: shots ? Number(shots[1]) : null,
    chars: chars ? Number(chars[1]) : null,
  }
}

/** Declared 图位 mapping. */
function parseSlots(text) {
  const slots = new Map()
  const line = text.match(/^图位[：:]\s*(.+)$/m)
  if (!line) return slots
  for (const m of line[1].matchAll(/@图(\d+)\s*=\s*([^，,]+)/g)) {
    slots.set(Number(m[1]), m[2].trim())
  }
  return slots
}

/** One finding. level: block | warn | ok */
const finding = (level, rule, label, shot, detail, fix) => ({ level, rule, label, shot, detail, fix })

/**
 * Run all eight checks over one segment of storyboard markdown.
 * @param {string} text - storyboard markdown
 * @param {object} [options]
 * @returns {{blocking:number, warnings:number, passed:string[], findings:object[], meta:object}}
 */
export function check(text, options = {}) {
  const rate = options.charsPerSecond ?? 4
  const maxRefs = options.maxCharacterRefs ?? 2
  const minShot = options.minShotSeconds ?? 2
  const findings = []
  const passed = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])

  const segments = splitSegments(text)
  const header = parseHeader(text)
  const refs = parseRefs(text)
  const slots = parseSlots(text)
  const shots = parseShots(text)
  const durations = parseDurations(text, Math.max(shots.length, header.shotCount ?? 0))

  const add = (f) => {
    findings.push(f)
    if (f.level !== 'ok') passed.delete(f.rule)
  }

  // ---- R1 timing ledger -------------------------------------------------
  let totalChars = 0
  let totalSeconds = 0
  for (const shot of shots) {
    const line = shot.fields['台词'] || ''
    const inner = line.match(/\{([^}]*)\}/)
    const chars = spokenChars(inner ? inner[1] : '')
    totalChars += chars
    const sec = durations.get(shot.no)
    if (sec) totalSeconds += sec
    if (!chars || !sec) continue
    const need = chars / rate
    if (need > sec + 0.25) {
      add(finding('block', 'R1', '时长账', shot.no,
        `台词 ${chars} 字，按每秒 ${rate} 字要 ${need.toFixed(1)} 秒，这一镜只给了 ${sec} 秒`,
        `加时长到 ${Math.ceil(need * 2) / 2} 秒，或把台词压到 ${Math.floor(sec * rate)} 字以内`))
    }
  }
  if (durations.size === 0 && shots.length > 1) {
    add(finding('warn', 'R1', '时长账', null,
      '文件里没有可解析的镜头时长（缺「一眼看懂」表或时间码）', '补一张逐镜秒数表，否则时长无法对账'))
  }
  const shortShots = []
  for (const [no, sec] of durations) {
    if (sec < minShot) shortShots.push({ no, sec })
  }
  if (shortShots.length) {
    const secs = shortShots.map((s) => s.sec)
    add(finding('warn', 'R1', '时长账', null,
      `${shortShots.length} 个镜头低于 ${minShot} 秒下限（${Math.min(...secs)}–${Math.max(...secs)} 秒之间）：镜 ${shortShots.map((s) => s.no).join('、')}。低于 2 秒时观众只看见动作、看不见内容`,
      '合并相邻短镜，或按 2–3 秒重新分配本段时间'))
  }
  if (header.chars != null && totalChars && Math.abs(header.chars - totalChars) > 3) {
    add(finding('warn', 'R1', '时长账', null,
      `段头声明台词 ${header.chars} 字，逐镜累加是 ${totalChars} 字`, '改段头，或补齐漏写的台词'))
  }
  if (header.seconds && totalSeconds && Math.abs(header.seconds - totalSeconds) > 0.4) {
    add(finding('warn', 'R1', '时长账', null,
      `段头声明 ${header.seconds} 秒，逐镜累加 ${totalSeconds.toFixed(1)} 秒`, '对齐段头与逐镜秒数'))
  }

  // ---- R2 reference budget ---------------------------------------------
  const baseline = [...refs.values()].filter((r) => r.baseline && !r.tailFrame)
  if (baseline.length > maxRefs) {
    add(finding('block', 'R2', '参考图超量', null,
      `这一段给了 ${baseline.length} 张角色基准图（${baseline.map((r) => r.name).join('、')}），超过 ${maxRefs} 张上限，人脸特征权重被摊薄，越给越飘`,
      `只留本段戏份最重的 ${maxRefs} 张；其余改画外音、侧脸暗光，或纯文字指认后删图`))
  }
  for (const r of refs.values()) {
    if (r.backOnly) {
      add(finding('warn', 'R2', '参考图超量', null,
        `@图${r.no}（${r.name}）标注为背对/背影，锁脸用不上`, '删掉这张图，正文写「背对镜头」即可'))
    }
  }

  // ---- R3 speaker / frame mismatch -------------------------------------
  for (const shot of shots) {
    const line = shot.fields['台词'] || ''
    const frame = shot.fields['画面'] || ''
    const lipSync = /开口|口型同步/.test(line)
    const mentioned = [...line.matchAll(/@图(\d+)/g)].map((m) => Number(m[1]))
    if (lipSync) {
      const onScreen = mentioned.some((no) => frame.includes(`@图${no}`))
      if (!onScreen) {
        const no = mentioned[0]
        add(finding('block', 'R3', '开口错配', shot.no,
          no
            ? `台词写了「@图${no} 开口（口型同步）」，画面行里没有 @图${no}，模型只能自己造一张脸去对口型`
            : '台词写了开口/口型同步，但没有指明是谁在开口',
          no ? `改成「@图${no} 画外音」，或把 @图${no} 写进画面行` : '补上开口角色的 @图号，或改画外音'))
      }
    }
    for (const no of mentioned) {
      if (!refs.has(no) && slots.size > 0) {
        add(finding('block', 'R3', '开口错配', shot.no,
          `引用了 @图${no}，参考图清单里没有这张`, '补图，或改成已存在的图号'))
      }
    }
  }

  // ---- R4 appearance leakage -------------------------------------------
  for (const shot of shots) {
    const frame = shot.fields['画面'] || ''
    for (const term of APPEARANCE_TERMS) {
      if (!frame.includes(term)) continue
      add(finding('warn', 'R4', '外观泄漏', shot.no,
        `画面行出现「${term}」——这句在说他长什么样，不是在说他做什么，模型会照着重画一张脸`,
        '删掉外观描述，只留姿态动作（坐得直／往前倾／手放膝盖上）'))
      break
    }
  }

  // ---- R5 prompt hygiene ------------------------------------------------
  for (const r of refs.values()) {
    if (!r.generated) continue
    // A negative-prompt tail names what must NOT appear, so it never counts as
    // content: "负面词：人物、手、玻璃" is correct usage, not a defect.
    const body = r.line.split(/负面词/)[0]
    const hitParts = BODY_PART_TERMS.filter((t) => body.includes(t))
    if (hitParts.length) {
      // A hand that is actually depicted blocks the render; a hand named only as
      // wear ("手指按得发亮") is a wording suggestion.
      const depictsHand = /一[只双个把][^，。；]{0,10}手|手扶着|手握着|手指扶|手握|掌心里|指尖扶|手指捏|手指拿|托在掌心/.test(body)
      add(finding(depictsHand ? 'block' : 'warn', 'R5', '图提示词卫生', null,
        `@图${r.no}（${r.name}）是物件/场景图，提示词里出现「${hitParts[0]}」` +
        (depictsHand
          ? '，手会被焊死在图上，视频里一动就矛盾'
          : '——若只是形容磨损（被手摸得发亮）改成「磨得发亮」，别写手'),
        depictsHand ? '把这一句删掉，手和动作写进视频提示词' : '改成不出现身体部位的写法'))
    }
    const hitModern = MODERN_TERMS.filter((t) => body.includes(t))
    if (hitModern.length) {
      add(finding('block', 'R5', '图提示词卫生', null,
        `@图${r.no}（${r.name}）混进现代词「${hitModern.join('、')}」`, '换成古代器物的写法，并把现代词加进负面词'))
    }
    if (!/负面词/.test(r.line)) {
      add(finding('warn', 'R5', '图提示词卫生', null,
        `@图${r.no}（${r.name}）没有负面词`, '补负面词：人物、人脸、卡通、2D、文字、水印'))
    }
  }

  // ---- R6 freeze-frame chain -------------------------------------------
  const lastShot = shots[shots.length - 1]
  const freezeInLast = lastShot && /定格/.test(lastShot.body)
  const freezeAnywhere = /末帧定格|最后一镜定格/.test(text)
  if (!freezeAnywhere && !freezeInLast) {
    add(finding('block', 'R6', '尾帧链', lastShot ? lastShot.no : null,
      '全段没有「末帧定格」——下一段的第一帧接不上，这段等于白做',
      '在末镜补一行：谁／姿势／朝哪／光位／怎么框，并写明下一段就从这个画面起'))
  } else if (freezeAnywhere && !freezeInLast) {
    add(finding('warn', 'R6', '尾帧链', lastShot ? lastShot.no : null,
      '「末帧定格」没写在最后一镜里，落在中间某镜上了', '把定格挪到末镜'))
  }

  // ---- R7 knowledge boundary -------------------------------------------
  for (const term of OMEN_TERMS) {
    if (!text.includes(term)) continue
    add(finding('warn', 'R7', '知情边界', null,
      `出现「${term}」——检查这里是不是让角色说了他此刻不该知道的事`, '改成人话：只说这一刻看得见、问得出的事'))
    break
  }

  // ---- R8 sensitive terms ----------------------------------------------
  for (const term of SENSITIVE_TERMS) {
    const count = text.split(term).length - 1
    if (count === 0) continue
    add(finding('warn', 'R8', '高危词', null,
      `「${term}」出现 ${count} 次`, '换成不触审核的写法（如「刀」→「那把家什」），或删掉'))
  }

  const blocking = findings.filter((f) => f.level === 'block').length
  const warnings = findings.filter((f) => f.level === 'warn').length
  return {
    blocking,
    warnings,
    passed: [...passed].sort(),
    findings,
    meta: {
      segments: segments.length,
      shots: shots.length,
      seconds: totalSeconds ? Number(totalSeconds.toFixed(1)) : header.seconds,
      chars: totalChars,
      refs: refs.size,
      baselineRefs: baseline.length,
    },
  }
}

const RULE_NAMES = {
  R1: '时长账', R2: '参考图超量', R3: '开口错配', R4: '外观泄漏',
  R5: '图提示词卫生', R6: '尾帧链', R7: '知情边界', R8: '高危词',
}

/** Render the check result as the plain-text report the model should see. */
export function render(result) {
  const m = result.meta
  const out = []
  out.push(`分镜体检 · ${m.shots} 镜 / ${m.seconds ?? '?'} 秒 / 台词 ${m.chars} 字 / 参考图 ${m.refs} 张（角色基准 ${m.baselineRefs} 张）`)
  out.push(`必改 ${result.blocking} · 建议 ${result.warnings} · 通过 ${result.passed.length}/8 项`)
  out.push('')

  const marks = { block: '必改', warn: '建议', ok: '通过' }
  for (const f of result.findings) {
    out.push(`${marks[f.level]}｜${f.rule} ${f.label}${f.shot ? `｜镜头 ${f.shot}` : ''}`)
    out.push(`  ${f.detail}`)
    if (f.fix) out.push(`  → ${f.fix}`)
  }
  if (result.findings.length === 0) out.push('八项全过，这一段可以直接进渲染。')
  if (result.passed.length) {
    out.push('')
    out.push(`未命中：${result.passed.map((r) => `${r} ${RULE_NAMES[r]}`).join('、')}`)
  }
  return out.join('\n')
}
