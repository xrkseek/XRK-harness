import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '@xrkseek/xrk-api-remotes/client'
import { ReleaseNotesStore } from '../src/client/release-notes-store.ts'
import {
  RELEASE_NOTES_ACK_FIELD, RELEASE_NOTES_SETTINGS_NAMESPACE,
} from '../src/client/release-notes-copy.ts'
import {
  latestReleaseVersion, RELEASE_NOTES, RELEASE_NOTES_PINNED,
} from '../src/client/release-notes.ts'

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `notes-${rpc++}` as never, result: { ok: true, value } }
}

function namespace(version?: string) {
  return {
    ns: RELEASE_NOTES_SETTINGS_NAMESPACE,
    schema: {},
    value: version === undefined ? {} : { [RELEASE_NOTES_ACK_FIELD]: version },
    base: {},
    user: {},
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  }
}

function describeWith(version?: string) {
  return vi.fn(() => Promise.resolve(ok({
    writable: true, hasDocument: false, namespaces: [namespace(version)],
  })))
}

describe('ReleaseNotesStore', () => {
  it('marks unread until this exact version is acknowledged', async () => {
    const latest = latestReleaseVersion()
    expect(latest).toBeDefined()

    for (const [marker, unread] of [
      [undefined, true],
      ['older-copy', true],
      [latest, false],
    ] as const) {
      const controller = new ReleaseNotesStore({ settings: { describe: describeWith(marker) } } as never)
      await controller.load()
      expect(controller.store.getSnapshot()).toEqual({ status: 'ready', unread, error: null })
    }
  })

  it('persists the newest bundled version through one path mutation', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(namespace(latestReleaseVersion()))))
    const controller = new ReleaseNotesStore({ settings: { mutate } } as never)
    await expect(controller.markRead()).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledWith({
      ns: RELEASE_NOTES_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: [RELEASE_NOTES_ACK_FIELD], value: latestReleaseVersion() }],
    })
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', unread: false, error: null })
  })

  it('keeps the dot when a load or write fails — a failed read must not read as "read"', async () => {
    const load = new ReleaseNotesStore({
      settings: { describe: () => Promise.reject(new Error('offline')) },
    } as never)
    await load.load()
    expect(load.store.getSnapshot()).toEqual({ status: 'error', unread: true, error: 'offline' })

    const save = new ReleaseNotesStore({
      settings: { mutate: () => Promise.reject(new Error('disk full')) },
    } as never)
    await expect(save.markRead()).resolves.toBe(false)
    expect(save.store.getSnapshot()).toEqual({ status: 'error', unread: true, error: 'disk full' })
  })

  it('reports business failures and malformed durable values', async () => {
    const denied = new ReleaseNotesStore({
      settings: {
        describe: () => Promise.resolve({
          rpcId: 'denied' as never,
          result: { ok: false as const, error: { code: 'internal' as const, message: 'denied', details: {} } },
        }),
      },
    } as never)
    await denied.load()
    expect(denied.store.getSnapshot().error).toBe('denied')

    for (const value of [null, 42, { [RELEASE_NOTES_ACK_FIELD]: 42 }]) {
      const controller = new ReleaseNotesStore({
        settings: {
          describe: () => Promise.resolve(ok({
            writable: true,
            hasDocument: false,
            namespaces: [{ ...namespace(), value }],
          })),
        },
      } as never)
      await controller.load()
      expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', unread: true })
    }
  })

  it('reads read-only for a remote browser without touching the settings wire', async () => {
    const describe = vi.fn()
    const mutate = vi.fn()
    const controller = new ReleaseNotesStore({ settings: { describe, mutate } } as never, 'memory')
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', unread: false, error: null })
    await expect(controller.markRead()).resolves.toBe(true)
    expect(describe).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe('bundled release notes', () => {
  it('declares the newest version first and every note in both locales', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0)
    const versions = RELEASE_NOTES.map((note) => note.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect(latestReleaseVersion()).toBe(versions[0])

    for (const note of RELEASE_NOTES) {
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(note.title.zh.trim()).not.toBe('')
      expect(note.title.en.trim()).not.toBe('')
      expect(note.changes.length).toBeGreaterThan(0)
      for (const change of note.changes) {
        expect(change.zh.trim()).not.toBe('')
        expect(change.en.trim()).not.toBe('')
      }
    }
  })

  it('keeps the pinned notice outside the version list and unread marker', () => {
    expect(RELEASE_NOTES_PINNED).not.toBeNull()
    const pinned = RELEASE_NOTES_PINNED!
    expect(pinned.title.zh.trim()).not.toBe('')
    expect(pinned.title.en.trim()).not.toBe('')
    expect(pinned.changes.length).toBeGreaterThan(0)
    for (const change of pinned.changes) {
      expect(change.zh.trim()).not.toBe('')
      expect(change.en.trim()).not.toBe('')
    }
    expect(RELEASE_NOTES.some((note) => note.version === '0.1.0')).toBe(false)
    expect(latestReleaseVersion()).toBe('0.5.21')
  })
})