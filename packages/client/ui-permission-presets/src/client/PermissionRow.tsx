/**
 * Permission preference row: the default preset for subsequently created
 * sessions. Current-session switches remain on the composer `/permission`
 * control.
 */

import { memo, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconChevronDownOutline14, IconCloseFill14, Menu, RiskConfirmation,
} from '@xrkseek/client-ui-primitives'
import type { PermissionSettingsState } from './settings-store.ts'
import type { PermissionSettingsKey } from './locales.ts'
import { FULL_ACCESS_PRESET, displayPermissionPreset } from './presentation.ts'
import css from './PermissionRow.module.css'

/** Registration-side business face for the host-backed preference. */
export interface PermissionRowInjected {
  hooks: {
    /** Permission settings snapshot bound by the renderer as usePermission. */
    permission: SnapshotStore<PermissionSettingsState>
  }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist one advertised preset. */
  select: (preset: string) => Promise<void>
  /** Persist the explicit extra file-write allowlist (empty clears it). */
  saveRoots: (roots: readonly string[]) => Promise<boolean>
}

/** Full component props. */
export type PermissionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.permission'>
  & InjectFace<PermissionRowInjected>

/** Split a compose field into unique absolute-looking path tokens. */
export function parseRootPaths(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw.split(/[,;\n]/u)) {
    const path = entry.trim()
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

function mergeRoots(current: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(current)
  const next = [...current]
  for (const path of incoming) {
    if (seen.has(path)) continue
    seen.add(path)
    next.push(path)
  }
  return next
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Chip list + one-path compose; each add/remove persists immediately. */
const ExtraWritableRootsInput = memo(function ExtraWritableRootsInput({
  value,
  disabled,
  t,
  save,
}: {
  value: readonly string[]
  disabled: boolean
  t: PermissionRowProps['t']
  save: (roots: readonly string[]) => Promise<boolean>
}): ReactNode {
  const [draft, setDraft] = useState('')
  const addFromDraft = (): void => {
    const parsed = parseRootPaths(draft)
    if (parsed.length === 0) return
    const next = mergeRoots(value, parsed)
    if (next.length === value.length) {
      setDraft('')
      return
    }
    const pending = draft
    setDraft('')
    void save(next).then((ok) => {
      if (!ok) setDraft(pending)
    })
  }
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    addFromDraft()
  }
  return (
    <div className={css.roots} aria-busy={disabled || undefined}>
      <label className={css.rootsTitle} htmlFor="xrk-permission-extra-roots">
        {t('roots.label')}
      </label>
      {value.length > 0
        ? (
          <ul className={css.chips} aria-label={t('roots.label')}>
            {value.map((root) => (
              <li key={root} className={css.chip}>
                <span className={css.chipPath} title={root}>{root}</span>
                <button
                  type="button"
                  className={css.chipRemove}
                  aria-label={`${t('roots.remove')}: ${root}`}
                  disabled={disabled}
                  onClick={() => { void save(value.filter((entry) => entry !== root)) }}
                >
                  <IconCloseFill14 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )
        : null}
      <form className={css.compose} onSubmit={onSubmit}>
        <input
          id="xrk-permission-extra-roots"
          className={css.rootsInput}
          type="text"
          value={draft}
          placeholder={t('roots.placeholder')}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <button
          type="submit"
          className={css.rootsAdd}
          disabled={disabled || draft.trim() === ''}
        >
          {t('roots.add')}
        </button>
      </form>
      <p className={css.rootsHint}>{t('roots.hint')}</p>
    </div>
  )
})

/**
 * Render the new-session Permission default selector.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose permission settings.
 */
export function PermissionRow({ load, select, saveRoots, usePermission, t }: PermissionRowProps) {
  const status = usePermission(snapshot => snapshot.status)
  const writable = usePermission(snapshot => snapshot.writable)
  const error = usePermission(snapshot => snapshot.error)
  const currentValue = usePermission(snapshot => snapshot.currentValue)
  const options = usePermission(snapshot => snapshot.options)
  const extraWritableRoots = usePermission(
    snapshot => snapshot.extraWritableRoots,
    sameStringList,
  )
  const [open, setOpen] = useState(false)
  const [confirmingFullAccess, setConfirmingFullAccess] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (writable && status !== 'unavailable') return
    setOpen(false)
    setAcknowledged(false)
    setConfirmingFullAccess(false)
  }, [status, writable])

  if (status === 'unavailable') return null
  const selected = options.find(option => option.id === currentValue)
  const busy = status === 'loading' || status === 'saving' || confirmingFullAccess
  const label = selected === undefined
    ? (busy ? t('loading') : t('unavailable'))
    : displayPermissionPreset(selected.id, selected.label, t)
  const description: string = error ?? t('description')

  return (
    <>
      <div className={css.row} aria-busy={busy || undefined}>
        <div className={css.rowText}>
          <div className={css.title}>{t('title')}</div>
          <div className={css.desc} role={error === null ? undefined : 'alert'}>{description}</div>
          <div className={css.boundaryNote}>{t('boundary')}</div>
        </div>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={options.map(option => ({
            id: option.id,
            label: displayPermissionPreset(option.id, option.label, t),
          }))}
          selectedId={currentValue}
          onSelect={(id) => {
            setOpen(false)
            if (id === currentValue) return
            if (id === FULL_ACCESS_PRESET) {
              setAcknowledged(false)
              setConfirmingFullAccess(true)
              return
            }
            void select(id)
          }}
          align="end"
          portal
          anchor={(
            <button
              type="button"
              className={css.selector}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={busy || !writable || options.length === 0}
              onClick={() => { setOpen(value => !value) }}
            >
              {label}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          )}
        />
      </div>
      <ExtraWritableRootsInput
        value={extraWritableRoots}
        disabled={busy || !writable}
        t={t}
        save={saveRoots}
      />
      <RiskConfirmation
        open={confirmingFullAccess}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={!writable || status === 'saving'}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
        }}
        onConfirm={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
          void select(FULL_ACCESS_PRESET)
        }}
      />
    </>
  )
}

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}
