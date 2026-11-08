# manju-fenjing-check

**A storyboard quality checker for AI short-form drama, as a DeepSeek Harness plugin.**

Registers one tool, `storyboard_check`. Give it a storyboard segment; it returns a graded report of everything that will break *before* you pay to render it.

```
分镜体检 · 10 镜 / 15.1 秒 / 台词 41 字 / 参考图 5 张（角色基准 2 张）
必改 1 · 建议 2 · 通过 6/8 项

必改｜R1 时长账｜镜头 9
  台词 7 字，按每秒 4 字要 1.8 秒，这一镜只给了 1.4 秒
  → 加时长到 2 秒，或把台词压到 5 字以内
```

Status: **working, verified end to end against `@deepseek-ai/dsh` 0.2.2-rc.1** — mounted through a `--patch` overlay, called by the model, report returned intact. The rule engine is deterministic: no model call, no network, no dependencies.

---

## The problem

Producing AI short drama means feeding a text-to-video model (Seedance, Kling, Hailuo, Veo) a shot list plus a handful of reference images, one 15-second segment at a time. Five things go wrong over and over, and you usually find out after paying for the render:

| Symptom | Root cause |
|---|---|
| **The face drifts** between shots | Too many character reference images per segment; or a character is told to speak while absent from the frame; or the shot description restates their build and clothing, so the model regenerates them |
| **Timing collapses** | Line length does not reconcile with shot duration; the model averages a 10-shot segment into 3-second chunks |
| **Segments don't connect** | The final shot of segment N never states a freeze-frame, so segment N+1 opens on a different world |
| **Platform rejection** | Sensitive-content terms buried in the prompts |
| **Anachronisms** | A period kitchen stocked with stainless steel and ceramic tile |

This plugin turns those into eight mechanical checks you can run in a second.

## The eight checks

| # | Check | Rule |
|---|-------|------|
| R1 | **Timing ledger** | Dialogue characters ÷ reading rate ≈ seconds, reconciled per shot. Shots under 2s are flagged; declared totals must match the sum of shot durations. |
| R2 | **Reference budget** | Max **2** character reference images per segment. Beyond two, identity weight is split and likeness degrades. Back-only references are useless for a face and get flagged. |
| R3 | **Speaker / frame mismatch** | A lip-sync directive requires the referenced image to appear in the frame line. Otherwise the model invents a face. Also catches references to images that were never declared. |
| R4 | **Appearance leakage** | Shot descriptions may state what a character *does*, never what they *look like*. Restating appearance re-rolls the face. |
| R5 | **Prompt hygiene** | Prop and plate images must not depict hands or face fragments (they get welded into the image and contradict the video), and must not smuggle in modern objects. Negative-prompt tails are exempt — naming what must not appear is correct usage. |
| R6 | **Freeze-frame chain** | The last shot of a segment must end with an explicit freeze-frame. Missing it means the next segment starts on a different world. |
| R7 | **Knowledge boundary** | Flags wording that hints a character knows more than they could at that moment. Advisory — semantics need a human. |
| R8 | **Sensitive-term scan** | A 21-term list scanned across the whole segment. |

Every finding carries a shot number, the offending value, and a concrete fix.

## Install

The plugin is an ordinary npm-shaped package with a `dsh.bundle` declaration.

```sh
# from a local clone
dsh plugin --profile web add link:/absolute/path/to/manju-fenjing-check

# or from a git source, once published
dsh plugin --profile web add "github:wujiaxiao69-arch/manju-fenjing-check#main"
```

Restart `dsh web` after installing a bundle, then confirm the mount:

```sh
dsh web --dump-config | grep manju-fenjing-check
```

## Try it without installing

A patch overlay mounts the source file directly — good for hacking on the rules:

```yaml
# scratch/dev.patch.yml
- insert:
    - id: manju-fenjing-check
      name: '/absolute/path/to/manju-fenjing-check/index.js'
```

```sh
dsh web --patch ./scratch/dev.patch.yml
```

The plugin path must be absolute; a relative path silently fails to resolve.

## Tool signature

| Parameter | Type | Notes |
|---|---|---|
| `storyboard` | string, required | The full segment markdown: shot blocks, reference-image prompts, video-prompt section |
| `chars_per_second` | number | Reading rate for the timing ledger. Default `4` |
| `max_character_refs` | integer | Reference budget per segment. Default `2` |

Returns `{ blocking, warnings, report }`, where `report` is the rendered text above.

## Test

```sh
node run-tests.mjs              # synthetic fixtures, 10 assertions
node run-tests.mjs segment.md   # also lint a real segment
```

No dependencies, no framework — plain Node.

## Roadmap

- [x] Deterministic rule engine over the eight checks
- [x] DSH plugin wrapper (`defineTool`, `inject: ['tools']`)
- [ ] R7 semantics: optional LLM pass for the knowledge boundary
- [ ] Client-side panel (input pane, graded report card) instead of plain text

## Related

`manju-fenjing` — the production-side skill: segment splitting, timing ledger, delivery-format export, four self-check scripts.

## License

MIT
