// @vitest-environment jsdom
// Assembled welcome-page regression: the real `apps/web/dist` boot graph, the
// real built plugin bundles, no session.
//
// The bug this pins: the composer read the Face voice namespace as a property
// (`ctx.remote.voice`). That is an inject-checked access in cordis, so every
// fiber that did not list `remote.voice` threw during the inject factory and
// the `conversation.composer.bar` slot boundary took the whole composer down —
// on the welcome page, before any session existed. The fix reads the service
// by name (`ctx.get('remote.voice')`), which is a container query and degrades
// to "no dictation seat".
//
// Depends on a built `apps/web/dist` (gitignored). Without one the suite skips
// rather than reds: it is a deployed-graph check, not a source-only unit.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppWebEntry } from '@xrkseek/client-web'
import type { WebBootEntry } from '@xrkseek/client-modules/client'

const DIST = join(process.cwd(), 'apps/web/dist')
const MANIFEST = join(DIST, 'boot.json')

interface BootManifest { rev: string; entries: WebBootEntry[] }

/**
 * Prefer the workspace build of the two packages under change over the deployed
 * copy: a stale dist must not hide a source regression.
 */
const FRESH = new Map<string, string>([
  ['/plugins/@xrkseek/client-ui-conversation/client.js', 'packages/client/ui-conversation/lib/client.js'],
  ['/plugins/@xrkseek/client-ui-settings-plugins/client.js', 'packages/client/ui-settings-plugins/lib/client.js'],
])

function bundlePathOf(url: string): string {
  const deployed = join(DIST, url.replace(/^\//, ''))
  const fresh = FRESH.get(url)
  if (fresh === undefined) return deployed
  const freshPath = join(process.cwd(), fresh)
  return existsSync(freshPath) ? freshPath : deployed
}

const boot = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as BootManifest)
  : undefined
const bundles = new Map(
  boot === undefined
    ? []
    : boot.entries.map((entry) => [entry.url, readFileSync(bundlePathOf(entry.url), 'utf8')] as const),
)

const win = window as Window & { __XRK_BOOT__?: unknown; __ModuleLoader__?: unknown }

const errors: string[] = []
let unmount: (() => void) | undefined

beforeEach(() => {
  errors.length = 0
  // The slot boundary logs its crash through console.error; capture, then let
  // the original through for a readable failure.
  const original = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(value => (value instanceof Error ? `${value.message}\n${value.stack ?? ''}` : String(value))).join(' '))
    void original
  })
  vi.stubGlobal('ResizeObserver', class { observe(): void {}; disconnect(): void {}; unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => { callback(0) }, 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { clearTimeout(id) })
  // jsdom has no matchMedia; the composer's pointer gate and the chat preview
  // tabs both read it. Desktop match, so the dictation gate stays inert.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
})

afterEach(() => {
  act(() => { unmount?.() })
  unmount = undefined
  delete win.__XRK_BOOT__
  delete win.__ModuleLoader__
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-plugin]').forEach((style) => { style.remove() })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.skipIf(boot === undefined)('assembled composer (welcome page)', () => {
  it('renders the composer bar with no session and no voice Remote installed', async () => {
    history.replaceState(null, '', '/?fixture')
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    win.__XRK_BOOT__ = boot
    act(() => {
      const entry = new AppWebEntry(root, {
        loadBundle: async (url) => {
          const code = bundles.get(url)
          if (code === undefined) throw new Error(`missing built bundle ${url}`)
          ;(0, eval)(code)
        },
      })
      void entry.run()
      unmount = () => { entry.dispose() }
    })

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[role="textbox"], [contenteditable="true"]').length).toBeGreaterThan(0)
    }, { timeout: 20_000 })

    expect(errors.filter(line => /failed to render/i.test(line))).toEqual([])
    expect(errors.filter(line => /without inject/i.test(line))).toEqual([])
  }, 60_000)
})
