import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopPathForFile,
  normalizeMentionPath,
  pathReferenceInsert,
  resolveDroppedDirectories,
} from '../src/client/drop-path-intake.ts'

describe('drop-path-intake', () => {
  afterEach(() => {
    delete (globalThis as { xrkDesktop?: unknown }).xrkDesktop
  })

  it('normalizes Windows separators for mention grammar', () => {
    expect(normalizeMentionPath(String.raw`C:\Users\x\Home`)).toBe('C:/Users/x/Home')
  })

  it('builds a folder chip insert with trailing slash', () => {
    expect(pathReferenceInsert(String.raw`C:\Users\x\Home`, 'directory')).toEqual({
      source: 'reference',
      ref: '@C:/Users/x/Home/',
      label: 'Home/',
      appearance: 'folder',
      clipboardText: '@C:/Users/x/Home/',
    })
  })

  it('quotes paths that contain spaces', () => {
    expect(pathReferenceInsert('C:/Users/x/My Home', 'directory')).toEqual({
      source: 'reference',
      ref: '@"C:/Users/x/My Home/',
      label: 'My Home/',
      appearance: 'folder',
      clipboardText: '@"C:/Users/x/My Home/',
    })
  })

  it('resolves directories through the Desktop path bridge', () => {
    const file = new File([], 'Home')
    ;(globalThis as {
      xrkDesktop?: { files: { pathForFile: (f: File) => string | undefined } }
    }).xrkDesktop = {
      files: {
        pathForFile: (f) => (f === file ? String.raw`C:\Users\x\Home` : undefined),
      },
    }
    expect(desktopPathForFile(file)).toBe(String.raw`C:\Users\x\Home`)
    expect(resolveDroppedDirectories([file])).toEqual({
      resolved: [{ path: String.raw`C:\Users\x\Home`, kind: 'directory' }],
      unresolved: [],
    })
  })

  it('marks directories unresolved when Desktop bridge is absent', () => {
    const file = new File([], 'Home')
    expect(resolveDroppedDirectories([file])).toEqual({
      resolved: [],
      unresolved: [file],
    })
  })
})
