/**
 * Pure draft decoration scan — root vitest gate (`*.test.ts`), no jsdom.
 * Mirror of the scanTextRefs cases in input-machine.client.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { deriveDecorations, scanTextRefs } from '../src/client/input/decorations.ts'

describe('decorations: scanTextRefs', () => {
  const LEX: ReadonlyMap<'/' | '@', readonly string[]> = new Map([
    ['/', ['commit-helper', 'fixture-demo']],
    ['@', ['worker-1']],
  ])

  it('matches lexicon tokens at line start and after whitespace, in draft order', () => {
    expect(scanTextRefs('/commit-helper then @worker-1 ok', LEX)).toEqual([
      { start: 0, end: 14, trigger: '/' },
      { start: 20, end: 29, trigger: '@' },
    ])
  })

  it('a cold (empty) lexicon scans nothing', () => {
    expect(scanTextRefs('/commit-helper', new Map())).toEqual([])
  })

  it('recognizes directory paths independently of the dynamic lexicon', () => {
    expect(scanTextRefs('open @src/components/ or @"docs/design notes/', new Map())).toEqual([
      { start: 5, end: 21, trigger: '@', appearance: 'folder' },
      { start: 25, end: 45, trigger: '@', appearance: 'folder' },
    ])
  })

  it('does not paint a folder prefix out of a nested file path', () => {
    const draft = '@downloads/原文/2027-目录调整表-预通知1732.png'
    expect(scanTextRefs(draft, new Map())).toEqual([
      { start: 0, end: draft.length, trigger: '@', appearance: 'file' },
    ])
    expect(scanTextRefs('see @src/components/Button.tsx please', new Map())).toEqual([
      { start: 4, end: 30, trigger: '@', appearance: 'file' },
    ])
  })

  it('does not keep painting an unfinished unquoted path while typing at EOL', () => {
    expect(scanTextRefs('@extensions/dsh-compat', new Map())).toEqual([])
    expect(scanTextRefs('@extensions/dsh-compat11', new Map())).toEqual([])
    expect(scanTextRefs('@extensions/dsh-compat next', new Map())).toEqual([
      { start: 0, end: 22, trigger: '@', appearance: 'file' },
    ])
  })

  it('quoted file paths keep the whole token as a file reference', () => {
    expect(scanTextRefs('open @"docs/design notes/a.md"', new Map())).toEqual([
      { start: 5, end: 30, trigger: '@', appearance: 'file' },
    ])
  })

  it('recognizes workspace-root files with an extension (sidebar @ append)', () => {
    expect(scanTextRefs('@README.md', new Map())).toEqual([
      { start: 0, end: 10, trigger: '@', appearance: 'file' },
    ])
    expect(scanTextRefs('@README.md ', new Map())).toEqual([
      { start: 0, end: 10, trigger: '@', appearance: 'file' },
    ])
    expect(scanTextRefs('see @"README.md" please', new Map())).toEqual([
      { start: 4, end: 16, trigger: '@', appearance: 'file' },
    ])
    expect(scanTextRefs('@package.json next', new Map())).toEqual([
      { start: 0, end: 13, trigger: '@', appearance: 'file' },
    ])
    // No slash and no extension → lexicon-only (not a path file chip).
    expect(scanTextRefs('@README', new Map())).toEqual([])
  })

  it('directories need a trailing slash (sidebar appends @path/ + space)', () => {
    expect(scanTextRefs('@知识库/英语一', new Map())).toEqual([])
    expect(scanTextRefs('@知识库/英语一/', new Map())).toEqual([
      { start: 0, end: 9, trigger: '@', appearance: 'folder' },
    ])
    expect(scanTextRefs('@知识库/英语一/ next', new Map())).toEqual([
      { start: 0, end: 9, trigger: '@', appearance: 'folder' },
    ])
  })

  it('a trailing space after a file mention keeps later typing undecorated', () => {
    expect(scanTextRefs('@知识库/备考/本机清单.md hello', new Map())).toEqual([
      { start: 0, end: 15, trigger: '@', appearance: 'file' },
    ])
  })

  it('names off the lexicon do not match; triggers are routed per lexicon list', () => {
    expect(scanTextRefs('/unknown @commit-helper', LEX)).toEqual([])
  })

  it('word boundary: a trigger glued to text never matches', () => {
    expect(scanTextRefs('x/commit-helper', LEX)).toEqual([])
    expect(scanTextRefs('a@worker-1', LEX)).toEqual([])
  })

  it('tokens never cross a newline; a token straight after one matches', () => {
    expect(scanTextRefs('line\n/commit-helper', LEX)).toEqual([
      { start: 5, end: 19, trigger: '/' },
    ])
  })

  it('deriveDecorations threads the lexicon through as textRefs', () => {
    expect(deriveDecorations({
      draft: 'use /commit-helper now',
      imageIds: [],
      draftRev: 0,
      phase: 'plain',
      occurrences: [],
      queue: [],
    }, LEX).textRefs).toEqual([
      { start: 4, end: 18, trigger: '/' },
    ])
  })
})
