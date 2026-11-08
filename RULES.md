# The Eight Checks — Public Rule Summary

> Public summary of the rule engine's specification. Thresholds, repair phrasings and the failure-case library ship with the released plugin.

## 1. Timing ledger
- Character count ÷ reading rate reconciles against the shot's timeline slot
- No shot under 2 seconds; silent shots still occupy their own full slot
- The timeline must enumerate each shot separately and explicitly forbid averaging or merging

## 2. Reference budget
- Max 2 character reference images per segment: the lead plus the heaviest supporting role in that segment
- Beyond two, identity weight is split across references and likeness degrades
- A character with no lines and no on-screen presence gets no reference image

## 3. Speaker / frame mismatch
- A lip-sync directive requires the referenced image to appear in the frame description
- Coverage of hands, props or empty plates uses voice-over, never lip-sync

## 4. Appearance leakage
- Shot descriptions state action, not physique, wardrobe or age
- Test: does the sentence describe *what they are doing* or *what they look like*? The latter is removed

## 5. Prompt hygiene
- Prop and empty-plate images depict the object alone; hands belong in the video prompt, not the image prompt
- Period settings carry a negative-prompt block: stainless steel, non-stick, aluminium, enamelware, ceramic tile, glass, plastic

## 6. Freeze-frame chain
- Every segment's final shot ends with an explicit freeze-frame: subject, pose, facing, key light, framing
- The next segment's first frame is that frame, with no re-roll

## 7. Knowledge boundary
- A character speaks only from information they personally obtained by that moment
- No prophecy, no authorial explanation, no omen-reading on the audience's behalf

## 8. Sensitive-term scan
- A 21-term list, scanned across the storyboard markdown and the exported delivery text
