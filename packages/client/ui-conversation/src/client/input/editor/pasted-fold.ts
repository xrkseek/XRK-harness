/**
 * Fold planning: split externally-entering text into plain runs and over-long
 * folds, so the composer never holds a wall of text inside contenteditable.
 *
 * One pure decision shared by all three external-text entry points (paste,
 * persisted-draft seed, restored failure snapshot), so a draft that was
 * folded on the way in is folded identically on every later re-entry — the
 * fold is a property of the text, not of the gesture that delivered it.
 *
 * Rule: walk lines, accumulate into a plain run, and close the run as a fold
 * the moment it crosses the character threshold. A short paste therefore
 * stays literal text (no surprise chip on a one-line paste), while a big
 * block is absorbed whole from the start of its run up to the crossing
 * point. Lines after a fold start a fresh plain run and are judged on their
 * own, so the tail of a long paste is never swallowed by the head's fold.
 *
 * Ceiling: the fold body still lives in editor memory as one string. A draft
 * made of a million pathological pastes would still weigh memory; spilling
 * bodies to disk and keeping a handle is the upgrade path.
 */

/** Characters a plain run may hold before it becomes a fold. */
export const FOLD_THRESHOLD_CHARS = 2000

/**
 * Line count that folds even under the char threshold — a copied chat reply
 * is often short in bytes but many lines; leaving it literal still janks the
 * contenteditable layout path the fold exists to avoid.
 */
export const FOLD_THRESHOLD_LINES = 8

/** One planned piece of external text. */
export type FoldPart =
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'fold'; readonly text: string }

/**
 * Split external text into plain runs and over-long folds.
 * @param text - the incoming text (already placeholder-sanitized or not;
 *   this layer does not sanitize).
 * @returns the ordered parts; a single plain part when nothing exceeds the
 *   threshold, so the common case stays byte-identical to the input.
 */
export function planPastedFold(text: string): readonly FoldPart[] {
  const lineCount = text.length === 0 ? 0 : text.split('\n').length
  if (text.length <= FOLD_THRESHOLD_CHARS) {
    // Multi-line under the char ceiling folds whole (copied chat replies).
    if (lineCount >= FOLD_THRESHOLD_LINES) return [{ kind: 'fold', text }]
    return [{ kind: 'plain', text }]
  }
  const lines = text.split('\n')
  const parts: FoldPart[] = []
  let run: string[] = []
  let runChars = 0
  const flushRun = (): void => {
    if (run.length === 0) return
    parts.push({ kind: 'plain', text: run.join('\n') })
    run = []
    runChars = 0
  }
  for (const line of lines) {
    run.push(line)
    runChars += line.length + 1
    if (runChars >= FOLD_THRESHOLD_CHARS) {
      // The whole accumulated run folds — from its first line, not just the
      // crossing line, so the fold is one contiguous block of the original.
      parts.push({ kind: 'fold', text: run.join('\n') })
      run = []
      runChars = 0
    }
  }
  flushRun()
  return parts
}