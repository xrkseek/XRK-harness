import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadUrl } from '../src/client/controller.ts'

afterEach(() => {
  delete (globalThis as { XrkShell?: unknown }).XrkShell
  vi.restoreAllMocks()
})

describe('downloadUrl', () => {
  it('posts to XrkShell on the phone thin shell only', () => {
    const postMessage = vi.fn()
    ;(globalThis as { XrkShell?: { postMessage: (raw: string) => void } }).XrkShell = { postMessage }
    const createElement = vi.spyOn(document, 'createElement')
    downloadUrl('http://127.0.0.1/api/session.export?sessionId=s1', 'xrk-session-s1.zip')
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        op: 'download',
        url: 'http://127.0.0.1/api/session.export?sessionId=s1',
        filename: 'xrk-session-s1.zip',
      }),
    )
    expect(createElement).not.toHaveBeenCalled()
  })

  it('uses <a download> on Desktop / ordinary browsers without XrkShell', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadUrl('http://127.0.0.1/api/session.export?sessionId=s1', 'xrk-session-s1.zip')
    expect(click).toHaveBeenCalled()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe('http://127.0.0.1/api/session.export?sessionId=s1')
    expect(anchor.download).toBe('xrk-session-s1.zip')
  })

  it('ignores a stub XrkShell without postMessage (Desktop must not be polluted)', () => {
    ;(globalThis as { XrkShell?: { postMessage?: unknown } }).XrkShell = {}
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadUrl('/api/session.export?sessionId=s1', 'xrk-session-s1.zip')
    expect(click).toHaveBeenCalledTimes(1)
  })
})
