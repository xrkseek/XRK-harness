// @vitest-environment jsdom
// Folded-paste contract: over-long external text must never reach
// contenteditable as literal text, while every plain-text surface (draft
// persistence, submit, native copy) must still see the FULL body.
//
// The fold is invisible by design — if any of these break, the user either
// gets a wall of text back in the draft or loses their pasted content.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical'
import { DraftEditorRuntime } from '../src/client/input/editor/runtime.ts'
import {
  $isPastedTextNode, countLines, firstMeaningfulLine, PastedTextNode,
} from '../src/client/input/editor/pasted-text-node.tsx'
import { PastedText } from '../src/client/input/editor/PastedText.tsx'
import type { PastedTextProps } from '../src/client/input/editor/PastedText.tsx'
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

  it('the body stays out of the document: nothing inlines it as editable text', () => {
    const { rt } = editor()
    const text = bigBody()
    rt.paste(text)
    rt.refreshProjection()
    // No expand(): the type-level removal is the guarantee, so reaching for it
    // is a compile error rather than a runtime check.
    expect(Object.getOwnPropertyNames(PastedTextNode.prototype)).not.toContain('expand')
    // Typing next to the fold must not materialize its body either.
    rt.editor.update(() => {
      $getRoot().selectEnd().insertText('尾')
    }, { discrete: true })
    rt.refreshProjection()
    expect(foldsOf(rt)).toBeGreaterThan(0)
    expect(rt.projection.clipboardText.endsWith('尾')).toBe(true)
  })

  it('every fold still carries its own full body for the read-only viewer', () => {
    const { rt } = editor()
    // 3000 chars per line crosses the 2000 threshold on each line, so this
    // pastes as two independent folds — the assertion is per node, not once.
    const text = 'x'.repeat(3000) + '\n' + 'y'.repeat(3000)
    rt.paste(text)
    rt.refreshProjection()
    const carried: string[] = []
    rt.editor.getEditorState().read(() => { eachFold(node => { carried.push(node.getText()) }) })
    expect(carried).toEqual(['x'.repeat(3000), 'y'.repeat(3000)])
  })

  it('a saved edit re-projects the new body without unfolding the draft', () => {
    const { rt } = editor()
    rt.paste('x'.repeat(3000))
    rt.refreshProjection()
    rt.editor.update(() => {
      eachFold(node => { node.replaceText('改短了') })
    }, { discrete: true })
    rt.refreshProjection()
    expect(rt.projection.clipboardText).toBe('改短了')
  })

  it('saving back to an over-long body keeps it folded (the fold follows the text)', () => {
    const { rt } = editor()
    rt.paste('x'.repeat(3000))
    rt.refreshProjection()
    const longer = 'y'.repeat(6000)
    rt.editor.update(() => {
      eachFold(node => { node.replaceText(longer) })
    }, { discrete: true })
    rt.refreshProjection()
    expect(foldsOf(rt)).toBe(1)
    expect(rt.projection.clipboardText).toBe(longer)
  })

  it('trimming below the threshold inlines the text (a chip around a sentence is noise)', () => {
    const { rt } = editor()
    rt.paste('x'.repeat(3000))
    rt.refreshProjection()
    rt.editor.update(() => {
      eachFold(node => { node.replaceText('只剩一句\n第二句') })
    }, { discrete: true })
    rt.refreshProjection()
    expect(foldsOf(rt)).toBe(0)
    expect(rt.projection.clipboardText).toBe('只剩一句\n第二句')
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

  it('previews the first line that actually has content', () => {
    // Leading blank lines are common in copied log/clipboard payloads; the
    // preview must skip them instead of showing an empty box.
    expect(firstMeaningfulLine('\n\n  第一行内容 \n第二行')).toBe('第一行内容')
    expect(firstMeaningfulLine('a\r\nb')).toBe('a')
    // A whitespace-only body has nothing to preview; the row falls back to
    // the size summary rather than rendering an empty preview slot.
    expect(firstMeaningfulLine('  \n\t\n')).toBeUndefined()
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

describe('folded-paste chrome', () => {
  // Each test mounts its own row; the Modal portals to document.body, so an
  // earlier row surviving into the next would leak buttons into getAllByRole.
  afterEach(() => { cleanup() })

  /** Mount one folded-paste row over a stubbed clipboard. */
  function mount(overrides: Partial<PastedTextProps> = {}) {
    const writes: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => { writes.push(text); return Promise.resolve() },
      },
    })
    const props: PastedTextProps = {
      lines: 80, chars: 1200, preview: '第一行', text: '第一行\n第二行',
      onSave: () => {}, onDelete: () => {}, ...overrides,
    }
    const view = render(<PastedText {...props} />)
    return { writes, ...view }
  }

  it('offers edit and remove on the row, and nothing that inlines the body', () => {
    const { getAllByRole } = mount()
    const labels = getAllByRole('button').map(b => b.getAttribute('aria-label'))
    expect(labels).toEqual(['查看 / 编辑粘贴内容', '移除粘贴内容（Ctrl+Z 可撤销）'])
    // The escape hatch is gone by name too — a paste never becomes draft text
    // on a gesture; it only changes through the off-line surface's save.
    expect(labels.join(' ')).not.toContain('插入')
  })

  it('a small body opens an editable textarea OUTSIDE contenteditable', () => {
    mount()
    fireEvent.click(screen.getAllByRole('button')[0]!)
    const area = document.querySelector<HTMLTextAreaElement>('[data-composer-pasted-editor]')!
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.value).toBe('第一行\n第二行')
    // The whole point: the editable surface is a native control in a Modal,
    // never the composer.
    expect(area.closest('[contenteditable]')).toBeNull()
  })

  it('editing then saving hands the new body to onSave', () => {
    const saved: string[] = []
    mount({ onSave: next => { saved.push(next) } })
    fireEvent.click(screen.getAllByRole('button')[0]!)
    const area = document.querySelector<HTMLTextAreaElement>('[data-composer-pasted-editor]')!
    fireEvent.change(area, { target: { value: '改过的第一行' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saved).toEqual(['改过的第一行'])
  })

  it('save stays disabled until the body actually changes (a no-op must not mark history)', () => {
    mount()
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
    fireEvent.change(document.querySelector('[data-composer-pasted-editor]')!, {
      target: { value: 'x' },
    })
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false)
  })

  it('a cancelled edit does not leak into the next open', () => {
    mount()
    fireEvent.click(screen.getAllByRole('button')[0]!)
    fireEvent.change(document.querySelector('[data-composer-pasted-editor]')!, {
      target: { value: '改坏了' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(document.querySelector<HTMLTextAreaElement>('[data-composer-pasted-editor]')!.value)
      .toBe('第一行\n第二行')
  })

  it('an over-long body is read-only, head/tail capped, never editable', () => {
    // 30 lines × 700 chars = 21k, past EDIT_MAX_CHARS: editing a body this big
    // is the wall-of-text cost, so the surface reads and copies instead.
    const body = Array.from({ length: 30 }, (_, i) => `行 ${i} ${'x'.repeat(680)}`).join('\n')
    const { container } = mount({ chars: body.length, lines: 30, preview: '行 0', text: body })
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(container.ownerDocument.querySelector('[data-composer-pasted-editor]')).toBeNull()
    const view = document.querySelector('[data-composer-pasted-view]')!
    expect(view.closest('[contenteditable]')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    // Cap: 16 rows over 30 lines → 8 head + 8 tail, 14 hidden.
    expect(screen.getByRole('button', { name: '展开其余 14 行' })).toBeTruthy()
    const pres = [...document.querySelectorAll('pre')]
    expect(pres).toHaveLength(2)
    expect(pres[0]!.textContent!.startsWith('行 0 ')).toBe(true)
    expect(pres[1]!.textContent!.startsWith('行 22 ')).toBe(true)
  })

  it('expanding shows the whole body without an editable surface', () => {
    const body = Array.from({ length: 30 }, (_, i) => `行 ${i} ${'x'.repeat(680)}`).join('\n')
    mount({ chars: body.length, lines: 30, text: body })
    fireEvent.click(screen.getAllByRole('button')[0]!)
    fireEvent.click(screen.getByRole('button', { name: '展开其余 14 行' }))
    expect(document.querySelectorAll('pre')).toHaveLength(1)
    expect(document.querySelector('pre')!.textContent).toBe(body)
    expect(document.querySelector('[data-composer-pasted-editor]')).toBeNull()
  })

  it('copy takes the FULL body, never the displayed slice', async () => {
    const body = Array.from({ length: 30 }, (_, i) => `行 ${i} ${'x'.repeat(680)}`).join('\n')
    const { writes } = mount({ chars: body.length, lines: 30, text: body })
    fireEvent.click(screen.getAllByRole('button')[0]!)
    fireEvent.click(screen.getByRole('button', { name: '复制全部' }))
    await vi.waitFor(() => { expect(writes).toEqual([body]) })
    expect(await screen.findByRole('button', { name: '已复制' })).toBeTruthy()
  })

  it('removing fires the delete gesture', () => {
    let deleted = 0
    mount({ onDelete: () => { deleted += 1 } })
    fireEvent.click(screen.getAllByRole('button')[1]!)
    expect(deleted).toBe(1)
  })
})
