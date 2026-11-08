/**
 * Self-tests for the rule engine. No test framework, no dependencies.
 *
 *   node run-tests.mjs                      # synthetic fixtures
 *   node run-tests.mjs path/to/seg.md       # also lint a real segment file
 */

import { readFileSync } from 'node:fs'
import { check, render } from './rules.js'

let pass = 0
let fail = 0

function ok(label, condition, extra = '') {
  if (condition) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`) }
}

/** Build a segment fixture from parts. */
function fixture({ shots, refs, freeze = true, table = true }) {
  const rows = shots.map((s, i) =>
    `| ${i + 1} | ${s.sec} | 中景 | ${s.frame} | ${s.line || '（无台词）'} |`).join('\n')
  const refBlock = refs.map((r, i) => `@图${i + 1} ${r}`).join('\n\n')
  const shotBlocks = shots.map((s, i) => `### 镜头 ${i + 1}

- **景别**：中景
- **画面**：${s.frame}
- **台词**：${s.line || '（无台词）'}
${freeze && i === shots.length - 1 ? `- **末帧定格**：${s.freezeText || '画面停在柜台上，手停在袋口。'}` : ''}`).join('\n\n')

  const total = shots.reduce((a, s) => a + s.sec, 0)
  return `# 测试段

> ${total.toFixed(1)} 秒 / ${shots.length} 镜

${table ? `## 一眼看懂\n\n| 镜 | 秒 | 景别 | 画面 | 谁说什么 |\n|---|---|---|---|---|\n${rows}\n` : ''}
## 本段参考图及生成提示词

${refBlock}

## 本段视频提示词

图位：${refs.map((_, i) => `@图${i + 1}=角色${i + 1}`).join('，')}

${shotBlocks}
`
}

const GOOD = fixture({
  shots: [
    { sec: 2.5, frame: '@图2 从袋口捧出面线，袋口朝着秤盘', line: '@图2 开口（中年掌柜 0.9）：{半斤，是吧。}' },
    { sec: 2.5, frame: '面线落进秤盘，@图2 的手指在秤星上按了按', line: '@图2 画外音（中年掌柜 0.9）：{这袋新的，晒得干。}' },
  ],
  refs: ['@图1 上一段尾帧（你传·已生成）：柜台面，布袋摊开。负面词：人物、人脸。',
    '@图2 萧令仪（你传·基准图，固定角色，不用提示词）',
    '@图3 杆秤与秤盘（我出）：一杆老木秤横放在柜台上，杆身嵌着一排铜星点。负面词：人物、手、卡通。'],
})

console.log('synthetic fixtures')

// 1) clean segment should not raise blocking findings
{
  const r = check(GOOD)
  ok('干净段：无必改', r.blocking === 0, JSON.stringify(r.findings.filter((f) => f.level === 'block')))
}

// 2) lip-sync on an image absent from the frame
{
  const bad = fixture({
    shots: [
      { sec: 2.5, frame: '@图2 低头看着秤盘', line: '@图2 开口（中年掌柜 0.9）：{半斤，是吧。}' },
      { sec: 2.5, frame: '面线落进秤盘', line: '@图2 开口（中年掌柜 0.9）：{这袋新的，晒得干。}' },
    ],
    refs: ['@图1 上一段尾帧（你传·已生成）：柜台面。负面词：人物。',
      '@图2 陈记掌柜（你传·基准图，固定角色，不用提示词）'],
  })
  const r = check(bad)
  ok('开口错配被抓到', r.findings.some((f) => f.rule === 'R3' && f.level === 'block' && f.shot === 2))
}

// 3) three character references
{
  const bad = GOOD.replace(
    '@图3 杆秤与秤盘',
    '@图3 配角甲（你传·基准图，固定角色，不用提示词）\n\n@图4 配角乙（你传·基准图，固定角色，不用提示词）\n\n@图5 杆秤与秤盘',
  )
  const r = check(bad)
  ok('参考图超量被抓到', r.findings.some((f) => f.rule === 'R2' && f.level === 'block'))
}

// 4) missing freeze-frame
{
  const r = check(fixture({
    shots: [{ sec: 3, frame: '@图2 转身离开柜台', line: '' }],
    refs: ['@图1 上一段尾帧（你传·已生成）：柜台面。负面词：人物。',
      '@图2 萧令仪（你传·基准图，固定角色，不用提示词）'],
    freeze: false,
  }))
  ok('缺末帧定格被抓到', r.findings.some((f) => f.rule === 'R6' && f.level === 'block'))
}

// 5) prop image carrying a hand
{
  const bad = GOOD.replace('一杆老木秤横放在柜台上', '一只年轻女人的手扶着老木秤，一杆老木秤横放在柜台上')
  const r = check(bad)
  ok('道具图画手被抓到', r.findings.some((f) => f.rule === 'R5' && f.level === 'block'))
}

// 6) modern object in a period prompt
{
  const bad = GOOD.replace('一杆老木秤横放在柜台上', '一只不锈钢秤盘放在柜台上')
  const r = check(bad)
  ok('现代物件被抓到', r.findings.some((f) => f.rule === 'R5' && f.level === 'block'))
}

// 7) dialogue overflowing its shot
{
  const bad = fixture({
    shots: [{ sec: 1.4, frame: '@图2 站在柜台前', line: '@图2 开口（中年掌柜 0.9）：{这袋新的晒得干你拿回去先吃着不够再来。}' }],
    refs: ['@图1 上一段尾帧（你传·已生成）：柜台面。负面词：人物。',
      '@图2 陈记掌柜（你传·基准图，固定角色，不用提示词）'],
  })
  const r = check(bad)
  ok('台词超出时长被抓到', r.findings.some((f) => f.rule === 'R1' && f.level === 'block'))
}

// 8) appearance leakage
{
  const bad = fixture({
    shots: [
      { sec: 3, frame: '@图2 肩很宽、衣服洗得发白，从袋口捧出面线', line: '@图2 开口（中年掌柜 0.9）：{半斤，是吧。}' },
    ],
    refs: ['@图1 上一段尾帧（你传·已生成）：柜台面。负面词：人物。',
      '@图2 萧令仪（你传·基准图，固定角色，不用提示词）'],
  })
  const r = check(bad)
  ok('外观泄漏被抓到', r.findings.some((f) => f.rule === 'R4'))
}

// 9) report renders every finding with a fix
{
  const r = check(GOOD)
  const text = render(r)
  ok('报告含汇总行', /分镜体检 · \d+ 镜/.test(text), text.split('\n')[0])
  ok('报告含通过统计', /通过 \d+\/8 项/.test(text))
}

const real = process.argv[2]
if (real) {
  console.log(`\nreal file: ${real}`)
  const text = readFileSync(real, 'utf-8')
  const r = check(text)
  console.log(render(r))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail === 0 ? 0 : 1
