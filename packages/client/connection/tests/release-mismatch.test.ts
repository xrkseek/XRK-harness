import { describe, expect, it } from 'vitest'
import {
  createReleaseMismatchTracker,
  readShellReleaseVersion,
} from '../src/release-mismatch.ts'

describe('release mismatch tracker', () => {
  it('is quiet while the host version is stable', () => {
    const tracker = createReleaseMismatchTracker()
    expect(tracker.noteHostVersion('1.0.0')).toBeUndefined()
    expect(tracker.noteHostVersion('1.0.0')).toBeUndefined()
    expect(tracker.lastHostVersion).toBe('1.0.0')
  })

  it('flags a host upgrade across generations', () => {
    const tracker = createReleaseMismatchTracker()
    expect(tracker.noteHostVersion('1.0.0')).toBeUndefined()
    const mismatch = tracker.noteHostVersion('1.1.0')
    expect(mismatch).toEqual({
      kind: 'host-upgraded',
      shellVersion: undefined,
      previousHostVersion: '1.0.0',
      hostVersion: '1.1.0',
    })
  })

  it('flags a stale shell on first describe', () => {
    const tracker = createReleaseMismatchTracker({ shellVersion: '1.0.0' })
    const mismatch = tracker.noteHostVersion('1.1.0')
    expect(mismatch).toEqual({
      kind: 'shell-stale',
      shellVersion: '1.0.0',
      previousHostVersion: undefined,
      hostVersion: '1.1.0',
    })
  })

  it('reads __XRK_SHELL_VERSION__ from the global', () => {
    const g = { __XRK_SHELL_VERSION__: ' 2.3.4 ' } as typeof globalThis & {
      __XRK_SHELL_VERSION__?: string
    }
    expect(readShellReleaseVersion(g)).toBe('2.3.4')
  })
})
