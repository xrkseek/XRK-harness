// @vitest-environment jsdom
/**
 * The right-click model's own edges: what a hit resolves to, and which rows a
 * given hit yields. The host's behaviour (open, close, run, keyboard) is
 * specified in context-menu.client.spec.tsx; this file pins the branches that
 * a contenteditable-only host test cannot reach — a text control's selection,
 * a link under the pointer, an empty clipboard.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildContextMenuEntries,
  hasContextMenuSelection,
  probeContextMenuClipboard,
  readContextMenuHit,
} from '../src/context-menu.ts'
import type { ContextMenuActions, ContextMenuHit, ContextMenuLabels } from '../src/context-menu.ts'

const labels: ContextMenuLabels = {
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  pastePlainText: 'Paste as Plain Text',
  delete: 'Delete',
  selectAll: 'Select All',
  copyLink: 'Copy Link Address',
}

const actions: ContextMenuActions = {
  copy: vi.fn(),
  cut: vi.fn(),
  remove: vi.fn(),
  selectAll: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  copyText: vi.fn(),
  paste: vi.fn(),
}

/** Build a hit for an element, defaulting the fields each test does not care about. */
function hitOn(target: HTMLElement, overrides: Partial<ContextMenuHit> = {}): ContextMenuHit {
  const event = new MouseEvent('contextmenu', { clientX: 40, clientY: 60, bubbles: true })
  Object.defineProperty(event, 'target', { value: target })
  return { ...readContextMenuHit(event), ...overrides }
}

/** A textarea in the document with a set selection range. */
function textareaWithSelection(start: number, end: number): HTMLTextAreaElement {
  const el = document.createElement('textarea')
  el.value = 'draft text'
  document.body.append(el)
  el.setSelectionRange(start, end)
  return el
}

function rowsOf(hit: ContextMenuHit, clipboard = { hasText: false, hasFiles: false }): string[] {
  return buildContextMenuEntries({ hit, labels, clipboard, actions })
    .filter(entry => entry.kind === 'row')
    .map(entry => (entry.kind === 'row' ? entry.id : ''))
}

describe('context menu hit', () => {
  it('reads a text control selection, which is not a document selection', () => {
    const selected = textareaWithSelection(0, 5)
    expect(hasContextMenuSelection(hitOn(selected))).toBe(true)
    const caretOnly = textareaWithSelection(3, 3)
    expect(hasContextMenuSelection(hitOn(caretOnly))).toBe(false)
  })

  it('walks up to the editable ancestor and ignores read-only controls', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editor.append(inner)
    document.body.append(editor)
    expect(hitOn(inner).isEditable).toBe(true)

    const locked = document.createElement('textarea')
    locked.readOnly = true
    document.body.append(locked)
    expect(hitOn(locked).isEditable).toBe(false)
  })

  it('takes the anchor under the pointer and drops in-page hashes', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/adr'
    const inner = document.createElement('span')
    anchor.append(inner)
    document.body.append(anchor)
    expect(hitOn(inner).linkUrl).toBe('https://example.com/adr')

    const hash = document.createElement('a')
    hash.href = '#section'
    document.body.append(hash)
    expect(hitOn(hash).linkUrl).toBe('')
  })
})

describe('context menu rows', () => {
  it('greys paste on an empty clipboard and offers no plain-text row', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    document.body.append(editor)
    const entries = buildContextMenuEntries({
      hit: hitOn(editor), labels, clipboard: { hasText: false, hasFiles: false }, actions,
    })
    expect(rowsOf(hitOn(editor))).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'select-all'])
    const paste = entries.find(entry => entry.kind === 'row' && entry.id === 'paste')
    expect(paste?.kind === 'row' && paste.disabled).toBe(true)
  })

  it('enables paste when only an image is on the clipboard', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    document.body.append(editor)
    expect(rowsOf(hitOn(editor), { hasText: false, hasFiles: true }))
      .toContain('paste-plain')
  })

  it('offers copy alone on selected prose, and copy-link beside a link', () => {
    const paragraph = document.createElement('p')
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/adr'
    paragraph.append('ADR-0008', anchor)
    document.body.append(paragraph)
    const hit = hitOn(anchor, { selectionText: 'ADR-0008', linkUrl: 'https://example.com/adr' })
    expect(rowsOf(hit)).toEqual(['copy', 'copy-link'])
  })

  it('does not repeat a link row when the selection already is the URL', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/adr'
    document.body.append(anchor)
    const hit = hitOn(anchor, { selectionText: 'https://example.com/adr' })
    expect(rowsOf(hit)).not.toContain('copy-link')
  })

  it('says nothing at all where there is nothing to do', () => {
    const blank = document.createElement('div')
    document.body.append(blank)
    expect(rowsOf(hitOn(blank))).toEqual([])
  })
})

describe('context menu clipboard probe', () => {
  it('reports nothing when the engine exposes no clipboard', async () => {
    // jsdom ships no navigator.clipboard; that must degrade, not throw.
    expect(await probeContextMenuClipboard()).toEqual({ hasText: false, hasFiles: false })
  })

  it('separates text from other payload types', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        read: async () => [{ types: ['text/plain'] }],
        readText: async () => 'copied',
      },
    })
    expect(await probeContextMenuClipboard()).toEqual({ hasText: true, hasFiles: false })
    vi.unstubAllGlobals()
  })

  it('greys paste out when the clipboard read is refused', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { read: async () => { throw new Error('denied') } },
    })
    expect(await probeContextMenuClipboard()).toEqual({ hasText: false, hasFiles: false })
    vi.unstubAllGlobals()
  })
})