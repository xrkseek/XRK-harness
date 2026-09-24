// @vitest-environment jsdom
/**
 * Smoke: Lexical DraftEditorRuntime owns draft/chip truth (detect uses U+FFFC;
 * clipboard expands chips). Avoids SessionInputShell → client-runtime slots.
 */
import { describe, expect, it } from 'vitest'
import type { ObservableSnapshot } from '@xrkseek/client-runtime/client'
import { DraftEditorRuntime } from '../src/client/input/editor/runtime.ts'

Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0 }) as DOMRect

const EMPTY_LEXICON: ReadonlyMap<'/' | '@', readonly string[]> = new Map()

const lexiconFace: ObservableSnapshot<ReadonlyMap<'/' | '@', readonly string[]>> = {
  getSnapshot: () => EMPTY_LEXICON,
  subscribe: () => () => {},
}

function runtime(): { editor: DraftEditorRuntime; unregister: () => void } {
  let editor!: DraftEditorRuntime
  editor = new DraftEditorRuntime({
    onUpdate: () => { editor.refreshProjection() },
    openReference: () => false,
    activeClaimToken: () => null,
    lexicon: () => lexiconFace.getSnapshot(),
    resolveLexicon: () => lexiconFace,
  })
  const unregister = editor.register()
  editor.refreshProjection()
  return { editor, unregister }
}

describe('draft-editor runtime smoke', () => {
  it('setDraft publishes clipboard and detect projections', () => {
    const { editor, unregister } = runtime()
    editor.setDraft('hello @x')
    expect(editor.projection.clipboardText).toBe('hello @x')
    expect(editor.projection.detectText).toBe('hello @x')
    expect(editor.projection.occurrences).toEqual([])
    unregister()
  })

  it('insertReference mints a chip (detect FFFC, clipboard expands)', () => {
    const { editor, unregister } = runtime()
    editor.setDraft('hello @x')
    const ok = editor.insertReference(
      { start: 6, end: 8 },
      {
        source: 'reference',
        ref: 'r1',
        label: 'X',
        clipboardText: '@[X](ref:r1)',
      },
      '',
    )
    expect(ok).toBe(true)
    expect(editor.projection.detectText).toContain('\uFFFC')
    expect(editor.projection.clipboardText).toBe('hello @[X](ref:r1) ')
    expect(editor.projection.occurrences).toHaveLength(1)
    expect(editor.projection.occurrences[0]?.label).toBe('X')
    unregister()
  })

  it('exposes a Lexical editor instance', () => {
    const { editor, unregister } = runtime()
    expect(typeof editor.editor.getEditorState).toBe('function')
    unregister()
  })
})
