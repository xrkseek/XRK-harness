// @vitest-environment jsdom
// Folded-paste contract: over-long external text must never reach
// contenteditable as literal text, while every plain-text surface (draft
// persistence, submit, native copy) must still see the FULL body.
//
// The fold is invisible by design — if any of these break, the user either
// gets a wall of text back in the draft or loses their pasted content.

import { describe, expect, it } from 'vitest'
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical'
import { DraftEditorRuntime } from '../src/client/input/editor/runtime.ts'
import { $isPastedTextNode, countLines, type PastedTextNode } from '../src/client/input/editor/pasted-text-node.tsx'
import {
  planPastedFold,
  FOLD_THRESHOLD_CHARS,
  FOLD_THRESHOLD_LINES,
} from '../src/client/input/editor/pasted-fold.ts'

function editor() {
  const el = document.createElement('div')
  el.contentEditable = 'true'
  document.body.appendChild(el)
  const rt = new DraftEditorRuntime({
    onUpdate: () => {},
    openReference: () => false,
    activeClaimToken: () => null,
    lexicon: () => new Map(),
    resolveLexicon: () => undefined,
  })
  rt.register()
  rt.editor.setRootElement(el)
  return { rt, el }
}

/** A body comfortably over the fold threshold, several lines deep. */
function bigBody(lines = 80): string {
  return Array.from({ length: lines }, (_, i) => `第 ${i} 行 ${'内容'.repeat(20)}`).join('\n')
}

/** A body whose own total sits just over the threshold, so it folds whole. */
function exactBody(): string {
  const line = 'x'.repeat(50)
  return Array.from({ length: 50 }, () => line).join('\n')
}

/** Run a gesture over every folded-paste node in the current editor state. */
function eachFold(gesture: (node: PastedTextNode) => void): void {
  const walk = (node: LexicalNode): void => {
    if (!$isElementNode(node)) return
    for (const kid of [...node.getChildren()]) {
      if ($isPastedTextNode(kid)) {
        gesture(kid)
        continue
      }
      walk(kid)
    }
  }
  walk($getRoot())
}

const removeFolds = (): void => eachFold(node => { node.discard() })
const expandFolds = (): void => eachFold(node => { node.expand() })

/** Every folded-paste node in the current editor state. */
function foldsOf(rt: DraftEditorRuntime): number {
  return rt.editor.getEditorState().read(() => {
    let count = 0
    eachFold(() => { count += 1 })
    return count
  })
}

describe('planPastedFold', () => {
  it('leaves a short paste as one plain part, byte-identical', () => {
    const text = '一行短文\n第二行'
    expect(planPastedFold(text)).toEqual([{ kind: 'plain', text }])
  })

  it('folds an over-long run and round-trips to the exact input', () => {
    const text = bigBody()
    const parts = planPastedFold(text)
    expect(parts.some(part => part.kind === 'fold')).toBe(true)
    // Concatenating the parts must reproduce the input exactly — no dropped
    // or duplicated newline, which is what a bad line walk would produce.
    expect(parts.map(part => part.text).join('\n')).toBe(text)
  })

  it('keeps the tail after a fold as plain text', () => {
    // exactBody() crosses the threshold mid-body, so its tail lines and the
    // appended short line share the trailing plain run. That run must survive
    // intact — the fold must not swallow what comes after it.
    const parts = planPastedFold(`${exactBody()}\n${'短尾巴'}`)
    expect(parts.at(-1)!.kind).toBe('plain')
    expect(parts.at(-1)!.text.endsWith('短尾巴')).toBe(true)
    expect(parts.map(part => part.kind)).toEqual(['fold', 'plain'])
  })

  it('is idempotent on the folded round trip (re-fold yields the same text)', () => {
    const text = bigBody()
    const once = planPastedFold(text).map(p => p.text).join('\n')
    const twice = planPastedFold(once).map(p => p.text).join('\n')
    expect(twice).toBe(once)
  })
})

describe('folded paste in the composer', () => {
  it('a big paste becomes an atomic node, not literal text', () => {
    const { rt } = editor()
    const text = bigBody()
    rt.paste(text)
    rt.refreshProjection()
    expect(foldsOf(rt)).toBeGreaterThan(0)
    // The detect projection must NOT contain the body — that is the whole
    // point: trigger scanning and caret coordinates stay cheap.
    expect(rt.projection.detectText.length).toBeLessThan(text.length)
  })

  it('the clipboard projection still carries the FULL text (persistence + submit + copy)', () => {
    const { rt } = editor()
    const text = bigBody()
    rt.paste(text)
    rt.refreshProjection()
    expect(rt.projection.clipboardText).toBe(text)
  })

  it('a short paste stays literal text (no surprise chip)', () => {
    const { rt } = editor()
    const text = '短提示'
    rt.paste(text)
    rt.refreshProjection()
    expect(foldsOf(rt)).toBe(0)
    expect(rt.projection.clipboardText).toBe(text)
  })

  it('deleting the fold removes its body from every projection', () => {
    const { rt } = editor()
    // One single-line fold (no multi-fold `\n` separators / plain tail).
    const text = 'x'.repeat(FOLD_THRESHOLD_CHARS + 10)
    rt.paste(text)
    rt.refreshProjection()
    expect(foldsOf(rt)).toBe(1)
    rt.editor.update(() => {
      removeFolds()
    }, { discrete: true })
    rt.refreshProjection()
    expect(foldsOf(rt)).toBe(0)
    expect(rt.projection.clipboardText).toBe('')
  })

  it('expanding the fold re-inlines the body as ordinary text', () => {
    const { rt } = editor()
    const text = bigBody()
    rt.paste(text)
    rt.refreshProjection()
    rt.editor.update(() => {
      expandFolds()
    }, { discrete: true })
    rt.refreshProjection()
    expect(foldsOf(rt)).toBe(0)
    expect(rt.projection.clipboardText.trim()).toBe(text.trim())
  })

  it('a persisted draft re-seeded from the store stays folded (refresh survival)', () => {
    const { rt } = editor()
    const text = bigBody()
    rt.paste(text)
    rt.refreshProjection()
    const persisted = rt.projection.clipboardText
    // This is what ConversationSession does after a refresh / session switch:
    // wipe the editor and seed it again from the stored plain draft.
    rt.setDraft('')
    rt.setDraft(persisted)
    rt.refreshProjection()
    expect(foldsOf(rt)).toBeGreaterThan(0)
    expect(rt.projection.clipboardText).toBe(text)
  })

  it('counts the lines a fold reports in its summary', () => {
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\r\nb')).toBe(2)
  })

  it('the threshold is the documented one (a paste right below it stays plain)', () => {
    const justUnder = 'x'.repeat(FOLD_THRESHOLD_CHARS - 1)
    expect(planPastedFold(justUnder)).toEqual([{ kind: 'plain', text: justUnder }])
  })

  it('folds a multi-line paste under the char ceiling (copied chat replies)', () => {
    const text = Array.from({ length: FOLD_THRESHOLD_LINES }, (_, i) => `行 ${i}`).join('\n')
    expect(text.length).toBeLessThan(FOLD_THRESHOLD_CHARS)
    expect(planPastedFold(text)).toEqual([{ kind: 'fold', text }])
  })
})