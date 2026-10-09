// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@xrkseek/client-web-react'
import type { SidebarFooterActionOwnerProps } from '@xrkseek/client-ui-sidebar/client'
import { ReleaseNotesButton } from '../src/client/ReleaseNotesButton.tsx'
import type { ReleaseNotesButtonProps } from '../src/client/ReleaseNotesButton.tsx'
import { ReleaseNotesStore } from '../src/client/release-notes-store.ts'
import { RELEASE_NOTES_ACK_FIELD, RELEASE_NOTES_SETTINGS_NAMESPACE } from '../src/client/release-notes-copy.ts'
import { en, zh } from '../src/client/locales.ts'
import {
  latestReleaseVersion, RELEASE_NOTES, RELEASE_NOTES_PINNED,
} from '../src/client/release-notes.ts'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

function response<T>(value: T) {
  return { rpcId: 'notes-rpc' as never, result: { ok: true as const, value } }
}

/** Resolve note copy the way the locale face does: active locale, else en. */
function resolveText(text: unknown): string {
  if (typeof text === 'string') return text
  const map = text as { readonly en: string; readonly zh: string }
  return map.zh
}

function mount({ wide = true, marker }: { wide?: boolean; marker?: string } = {}) {
  const mutate = vi.fn(() => Promise.resolve(response({})))
  const api = {
    settings: {
      describe: () => Promise.resolve(response({
        writable: true,
        hasDocument: false,
        namespaces: [{
          ns: RELEASE_NOTES_SETTINGS_NAMESPACE,
          schema: {},
          value: marker === undefined ? {} : { [RELEASE_NOTES_ACK_FIELD]: marker },
          base: {},
          user: {},
          applies: 'live' as const,
          secrets: [],
          revision: 0,
        }],
      })),
      mutate,
    },
  }
  const controller = new ReleaseNotesStore(api as never)
  const owner: SidebarFooterActionOwnerProps = { wide }
  const props = {
    ...owner,
    controller,
    useReleaseNotes: bindSnapshotSelector(controller.store),
    t: (key: keyof typeof en) => zh[key],
    resolveText,
  } as unknown as ReleaseNotesButtonProps
  return { ...render(<ReleaseNotesButton {...props} />), controller, mutate }
}

describe('ReleaseNotesButton', () => {
  it('shows the unread dot until this version is acknowledged, then drops it', async () => {
    const fresh = mount()
    const button = await screen.findByRole('button', { name: `${zh.button} — ${zh.unreadBadge}` })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.querySelector('[aria-hidden]')?.getAttribute('data-unread')).toBe('true')

    const read = mount({ marker: latestReleaseVersion() })
    await vi.waitFor(() => {
      const readButton = read.container.querySelector('button[aria-expanded]')
      expect(readButton?.getAttribute('aria-label')).toBe(zh.button)
    })
    expect(read.container.querySelector('[aria-hidden]')?.getAttribute('data-unread')).toBe('false')
    fresh.unmount()
  })

  it('lists pinned + version headers; expanding the newest clears the unread marker', async () => {
    const h = mount()
    fireEvent.click(await screen.findByRole('button', { name: `${zh.button} — ${zh.unreadBadge}` }))

    const dialog = await screen.findByRole('dialog', { name: zh.dialogTitle })
    expect(within(dialog).getByText(zh.pinnedBadge)).toBeTruthy()
    if (RELEASE_NOTES_PINNED !== null) {
      expect(within(dialog).getByText(RELEASE_NOTES_PINNED.title.zh)).toBeTruthy()
    }
    for (const note of RELEASE_NOTES) {
      expect(within(dialog).getByText(note.version)).toBeTruthy()
      expect(within(dialog).getAllByText(note.date).length).toBeGreaterThan(0)
    }
    // Opening the dialog alone must not write the marker.
    expect(h.mutate).not.toHaveBeenCalled()

    const latest = RELEASE_NOTES[0]!
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(latest.version) }))
    for (const change of latest.changes) {
      expect(within(dialog).getByText(change.zh)).toBeTruthy()
    }
    await vi.waitFor(() => { expect(h.mutate).toHaveBeenCalledOnce() })
    expect(h.mutate).toHaveBeenCalledWith({
      ns: RELEASE_NOTES_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: [RELEASE_NOTES_ACK_FIELD], value: latestReleaseVersion() }],
    })
    await vi.waitFor(() => { expect(h.controller.store.getSnapshot().unread).toBe(false) })
  })

  it('renders the rail form without the label when the sidebar is collapsed', async () => {
    const h = mount({ wide: false })
    const button = await screen.findByRole('button', { name: `${zh.button} — ${zh.unreadBadge}` })
    expect(button.textContent).toBe('')
    fireEvent.click(button)
    expect(await screen.findByRole('dialog', { name: zh.dialogTitle })).toBeTruthy()
    h.unmount()
  })

  it('keeps the dot and explains a refused read write after expanding the newest', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const mutate = vi.fn(() => Promise.resolve({
      rpcId: 'refused' as never,
      result: {
        ok: false as const,
        error: {
          code: 'settings-rejected' as const,
          message: 'read only',
          details: { ns: RELEASE_NOTES_SETTINGS_NAMESPACE },
        },
      },
    }))
    const controller = new ReleaseNotesStore({
      settings: {
        describe: () => Promise.resolve(response({
          writable: true, hasDocument: false, namespaces: [],
        })),
        mutate,
      },
    } as never)
    render(<ReleaseNotesButton
      {...({ wide: true } as SidebarFooterActionOwnerProps)}
      {...({
        controller,
        useReleaseNotes: bindSnapshotSelector(controller.store),
        t: (key: keyof typeof en) => zh[key],
        resolveText,
      } as unknown as ReleaseNotesButtonProps)}
    />)

    fireEvent.click(await screen.findByRole('button', { name: `${zh.button} — ${zh.unreadBadge}` }))
    const dialog = await screen.findByRole('dialog', { name: zh.dialogTitle })
    const latest = RELEASE_NOTES[0]!
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(latest.version) }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh.markFailed)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().unread).toBe(true) })
  })
})
