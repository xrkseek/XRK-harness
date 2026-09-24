/**
 * General Settings rows: sidebar agent-opens / agent-terminals push gates
 * (Host `~/.xrk/sidebar/prefs.json`).
 */

import { useEffect } from 'react'
import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { SidebarAgentPushState } from './sidebar-agent-push-store.ts'
import type { SidebarAgentPushPrefKey } from './sidebar-prefs-api.ts'
import css from './SidebarAgentPushRows.module.css'

/** Registration-side face for both push rows (shared store). */
export interface SidebarAgentPushInjected {
  hooks: {
    /** Prefs snapshot bound as useSidebarAgentPush. */
    sidebarAgentPush: SnapshotStore<SidebarAgentPushState>
  }
  /** Load prefs when a row first mounts. */
  load: () => Promise<void>
  /** Persist one push gate. */
  set: (key: SidebarAgentPushPrefKey, value: boolean) => Promise<void>
}

/** Full component props. */
export type SidebarAgentPushRowsProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<SidebarAgentPushInjected>

/**
 * Render agent-opens + agent-terminals push switches.
 * @param props - composed slot props.
 * @returns both rows, or null when the Host prefs API is unavailable.
 */
export function SidebarAgentPushRows({
  load,
  set,
  useSidebarAgentPush,
  t,
}: SidebarAgentPushRowsProps) {
  const state = useSidebarAgentPush(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'unavailable') return null

  const busy = state.status === 'loading' || state.status === 'saving'
  const errorText = state.error === 'save-failed' ? t('sidebarPush.saveFailed') : null

  return (
    <>
      <PushSwitchRow
        title={t('sidebarPush.opens.title')}
        description={errorText ?? t('sidebarPush.opens.description')}
        error={errorText !== null}
        checked={state.agentOpenTools}
        disabled={busy}
        onChange={(next) => { void set('agentOpenTools', next) }}
        switchLabel={t('sidebarPush.opens.title')}
      />
      <PushSwitchRow
        title={t('sidebarPush.terminals.title')}
        description={errorText ?? t('sidebarPush.terminals.description')}
        error={errorText !== null}
        checked={state.agentTerminalTools}
        disabled={busy}
        onChange={(next) => { void set('agentTerminalTools', next) }}
        switchLabel={t('sidebarPush.terminals.title')}
      />
    </>
  )
}

function PushSwitchRow(props: {
  title: string
  description: string
  error: boolean
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
  switchLabel: string
}) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{props.title}</div>
        <div className={css.desc} role={props.error ? 'alert' : undefined}>{props.description}</div>
      </div>
      <button
        type="button"
        className={css.switch}
        role="switch"
        aria-checked={props.checked}
        aria-label={props.switchLabel}
        disabled={props.disabled}
        onClick={() => { props.onChange(!props.checked) }}
      >
        <span className={css.track} data-on={props.checked || undefined} aria-hidden="true">
          <span className={css.thumb} />
        </span>
      </button>
    </div>
  )
}
