// @vitest-environment jsdom
/**
 * DOM gesture contract: selection survives the menu stealing focus, and each
 * editing row still mutates the surface the right-click landed on — including
 * the Lexical-shaped beforeinput / clipboard events contenteditable hosts use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readContextMenuHit } from '../src/context-menu.ts'
import { domContextMenuActions } from '../src/contextMenuGestures.ts'

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
})

/** Build a hit against a live node the way the host does on contextmenu. */
function hitFor(target: HTMLElement): ReturnType<typeof readContextMenuHit> {
  const event = new MouseEvent('contextmenu', { clientX: 10, clientY: 10, bubbles: true })
  Object.defineProperty(event, 'target', { value: target })
  return readContextMenuHit(event)
}

/** Select every text node under an element. */
function selectAll(el: HTMLElement): void {
  const selection = window.getSelection()
  if (selection === null) throw new Error('jsdom has no Selection')
  const range = document.createRange()
  range.selectNodeContents(el)
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('domContextMenuActions selection restore', () => {
  it('deletes a contenteditable highlight after the menu has cleared it', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'hello world'
    document.body.append(editor)
    selectAll(editor)
    const hit = hitFor(editor)
    expect(hit.selectionText).toBe('hello world')

    // Menu focus steals the caret; the bookmark on the hit must still work.
    const thief = document.createElement('button')
    document.body.append(thief)
    thief.focus()
    expect(window.getSelection()?.toString() ?? '').toBe('')

    // No Lexical listener: beforeinput is not prevented, so execCommand runs.
    const exec = vi.fn((command: string) => {
      if (command !== 'delete') return false
      const live = window.getSelection()
      if (live === null || live.rangeCount === 0 || live.isCollapsed) return false
      live.getRangeAt(0).deleteContents()
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })

    domContextMenuActions.remove(hit)
    expect(exec).toHaveBeenCalledWith('delete')
    expect(editor.textContent).toBe('')
  })

  it('prefers beforeinput deleteContentBackward when the editor handles it', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'keep'
    document.body.append(editor)
    selectAll(editor)
    const hit = hitFor(editor)
    const exec = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    const types: string[] = []
    editor.addEventListener('beforeinput', (event) => {
      types.push(event.inputType)
      event.preventDefault()
      editor.textContent = ''
    })
    domContextMenuActions.remove(hit)
    expect(types).toEqual(['deleteContentBackward'])
    expect(exec).not.toHaveBeenCalled()
    expect(editor.textContent).toBe('')
  })

  it('selectAll scopes to the editable, not the whole document', () => {
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'inside'
    document.body.append(outside, editor)
    domContextMenuActions.selectAll(hitFor(editor))
    expect(window.getSelection()?.toString()).toBe('inside')
  })

  it('selectAll + remove clears a native textarea even when focus left it', () => {
    const area = document.createElement('textarea')
    area.value = 'draft body'
    document.body.append(area)
    area.focus()
    area.select()
    const hit = hitFor(area)
    const thief = document.createElement('button')
    document.body.append(thief)
    thief.focus()
    expect(document.activeElement).toBe(thief)

    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    })
    domContextMenuActions.remove(hit)
    expect(area.value).toBe('')
  })

  it('copy falls back to clipboard.writeText when execCommand cannot copy', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    })
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'copy me'
    document.body.append(editor)
    selectAll(editor)
    const hit = hitFor(editor)
    domContextMenuActions.copy(hit)
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('copy me')
    })
    vi.unstubAllGlobals()
  })

  it('undo/redo fire historyUndo/historyRedo beforeinput for contenteditable', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'x'
    document.body.append(editor)
    const types: string[] = []
    editor.addEventListener('beforeinput', (event) => {
      types.push(event.inputType)
      event.preventDefault()
    })
    const exec = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    const hit = hitFor(editor)
    domContextMenuActions.undo(hit)
    domContextMenuActions.redo(hit)
    expect(types).toEqual(['historyUndo', 'historyRedo'])
    expect(exec).not.toHaveBeenCalled()
  })

  it('cut dispatches a cut event and flushes the hit text to the system clipboard', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    })
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'snip'
    document.body.append(editor)
    selectAll(editor)
    const hit = hitFor(editor)
    let sawCut = false
    editor.addEventListener('cut', (event) => {
      sawCut = true
      event.preventDefault()
      editor.textContent = ''
    })
    domContextMenuActions.cut(hit)
    expect(sawCut).toBe(true)
    expect(editor.textContent).toBe('')
    // jsdom's DataTransfer is incomplete; the hit still carries the text we cut.
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('snip')
    })
    vi.unstubAllGlobals()
  })
})
