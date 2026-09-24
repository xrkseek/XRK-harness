/**
 * Editor-facing re-exports for Lexical modules under input/editor/.
 * Canonical ComposerKeyboard / Occurrence / InputState live in input/contract.ts.
 */
export type {
  ComposerKeyboard, EditSelection, Occurrence,
} from '../input/contract.ts'
export type {
  ArbitrateKey, ArbitrateOutcome, ReferenceInsert, TokenSpan,
} from '@xrkseek/client-ui-input-trigger/client'
