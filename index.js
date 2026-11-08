/**
 * DeepSeek Harness plugin: storyboard quality checker for AI short-form drama.
 *
 * Registers one model-facing tool, `storyboard_check`, which runs the
 * deterministic rule engine in ./rules.js over a storyboard segment and returns
 * a graded MUST FIX / SUGGESTED report.
 *
 * Verified against @deepseek-ai/dsh-tools 0.2.2-rc.1.
 *
 * @module dsh-manju-fenjing-check
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { check, render, SENSITIVE_TERMS } from './rules.js'

export const name = 'manju-fenjing-check'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'storyboard_check',
    description: [
      'Run an eight-point quality check over one AI storyboard segment (markdown) before rendering it.',
      'Checks: dialogue-vs-shot-duration ledger, character reference budget, speaker/frame mismatch (lip-sync on an absent image),',
      'appearance leakage in shot descriptions, prop-image prompt hygiene (hands, partial faces, modern objects),',
      'freeze-frame chain, character knowledge boundary, and a sensitive-term scan.',
      'Returns a graded report: MUST FIX / SUGGESTED / PASS, each finding carrying a shot number, the offending line, and the fix.',
      'Use this whenever the user pastes a storyboard segment, a shot list, or video prompts and asks whether it will render correctly.',
    ].join(' '),
    parameters: {
      storyboard: {
        type: 'string',
        required: true,
        description: 'The full storyboard segment in markdown: shot blocks, reference-image prompts, and the video prompt section.',
      },
      chars_per_second: {
        type: 'number',
        description: 'Spoken characters per second used for the timing ledger. Default 4.',
      },
      max_character_refs: {
        type: 'integer',
        description: 'How many character reference images one segment may carry. Default 2.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blocking: { type: 'integer', description: 'Number of MUST FIX findings.' },
          warnings: { type: 'integer', description: 'Number of SUGGESTED findings.' },
          report: { type: 'string', description: 'The full graded report, ready to show the user.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(args) {
      const result = check(args.storyboard, {
        charsPerSecond: args.chars_per_second,
        maxCharacterRefs: args.max_character_refs,
      })
      return {
        blocking: result.blocking,
        warnings: result.warnings,
        report: render(result),
      }
    },
  }))
}

export { SENSITIVE_TERMS }
