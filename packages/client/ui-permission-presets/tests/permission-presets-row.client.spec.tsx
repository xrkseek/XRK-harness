// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@xrkseek/client-web-react'
import type { SettingsNamespaceView } from '@xrkseek/xrk-api-remotes/client'
import { PermissionRow, type PermissionRowProps, parseRootPaths } from '../src/client/PermissionRow.tsx'
import { en } from '../src/client/locales.ts'
import { PermissionPresetSettingsController } from '../src/client/settings-store.ts'

afterEach(cleanup)

const SCHEMA = {
  uid: 5,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', value: 'workspace-write' },
    3: { type: 'const', value: 'danger-full-access' },
    4: { type: 'union', list: [1, 2, 3] },
    5: { type: 'object', dict: { defaultPreset: 4 } },
  },
}

function view(
  defaultPreset: string,
  revision = 0,
  extraWritableRoots: readonly string[] = [],
): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema: SCHEMA,
    value: { defaultPreset, extraWritableRoots },
    base: { defaultPreset: 'read-only' },
    applies: 'live',
    secrets: [],
    revision,
  }
}

function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

const dictionary: Record<string, string> = en
const t: PermissionRowProps['t'] = key => dictionary[key] ?? key
const runtime = {
  useSessions: (() => { throw new Error('unused') }) as never,
  useWorkspaces: (() => { throw new Error('unused') }) as never,
}

function mount(controller: PermissionPresetSettingsController) {
  return render(
    <PermissionRow
      {...runtime}
      load={() => controller.load()}
      select={preset => controller.select(preset)}
      saveRoots={roots => controller.saveRoots(roots)}
      usePermission={bindSnapshotSelector(controller.store)}
      t={t}
    />,
  )
}

describe('PermissionRow', () => {
  it('loads the descriptor, opens the menu, and selects a new default', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 1))))
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      } as never,
    })
    mount(controller)
    const button = await screen.findByRole('button', { name: 'Read Only' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(button.getAttribute('aria-expanded')).toBe('false') })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read Only' }))
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace Write' }))
    await screen.findByRole('button', { name: 'Workspace Write' })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('requires explicit acknowledgement before saving Full access', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('danger-full-access', 1))))
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      } as never,
    })
    mount(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Read Only' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full access' }))
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Enable Full access?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Read Only' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full access' }))
    const dialog = screen.getByRole('dialog', { name: 'Enable Full access?' })
    const enable = screen.getByRole('button', { name: 'Enable Full access' })
    expect((enable as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(enable)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(dialog.isConnected).toBe(false)
  })

  it('hides an unavailable namespace and disables a read-only provider', async () => {
    const absent = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })),
        mutate: vi.fn(),
      } as never,
    })
    const rendered = mount(absent)
    await waitFor(() => { expect(rendered.container.textContent).toBe('') })
    rendered.unmount()

    const readonly = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: false, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: vi.fn(),
      } as never,
    })
    mount(readonly)
    expect((await screen.findByRole('button', { name: 'Read Only' })).hasAttribute('disabled')).toBe(true)
  })

  it('shows loading and a contained write error', async () => {
    const describe = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => describe.promise,
        mutate: () => Promise.resolve({
          rpcId: 'test',
          result: {
            ok: false as const,
            error: { code: 'settings-conflict', message: 'changed elsewhere', details: {} },
          },
        }),
      } as never,
    })
    mount(controller)
    expect((await screen.findByRole('button', { name: 'Loading' })).hasAttribute('disabled')).toBe(true)
    describe.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    const button = await screen.findByRole('button', { name: 'Read Only' })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace Write' }))
    expect((await screen.findByRole('alert')).textContent).toBe('changed elsewhere')
  })

  it('parses compose text into unique trimmed paths', () => {
    expect(parseRootPaths('  C:\\one; C:\\one, /tmp/two\n /tmp/two ')).toEqual([
      'C:\\one',
      '/tmp/two',
    ])
  })

  it('adds and removes extra writable roots immediately', async () => {
    const mutate = vi.fn((body: { ops: { value: unknown }[] }) => {
      const roots = body.ops[0]?.value as string[]
      return Promise.resolve(ok(view('read-only', 1, roots)))
    })
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({
          writable: true,
          hasDocument: false,
          namespaces: [view('read-only', 0, ['C:\\one'])],
        })),
        mutate,
      } as never,
    })
    mount(controller)
    expect(await screen.findByTitle('C:\\one')).toBeTruthy()
    const field = await screen.findByPlaceholderText('Paste or type an absolute path')
    fireEvent.change(field, { target: { value: 'D:\\shared' } })
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      ops: [{ op: 'set', path: ['extraWritableRoots'], value: ['C:\\one', 'D:\\shared'] }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove: C:\\one' }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(2) })
    expect(mutate.mock.calls[1]?.[0]).toMatchObject({
      ops: [{ op: 'set', path: ['extraWritableRoots'], value: ['D:\\shared'] }],
    })
  })
})
