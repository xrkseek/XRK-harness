/**
 * Desktop shell power / notify on Settings → General (Face `desktop`).
 * Hidden without the Desktop bridge — not under the Plugins compact entry.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SelectField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { DesktopCardFace } from './desktop-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

export type DesktopCardProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<DesktopCardFace>

function isDesktopShell(): boolean {
  return (globalThis as { xrkDesktop?: { preventIdleSleep?: unknown } }).xrkDesktop
    ?.preventIdleSleep !== undefined
}

/**
 * Prevent idle system sleep while a turn runs, plus session-complete OS notify.
 * Display may still blank — only system sleep is blocked (Codex prevent_idle_sleep).
 */
export function DesktopCard(props: DesktopCardProps) {
  const { t } = props
  const state = props.useDesktopCard(snapshot => snapshot)
  if (!isDesktopShell() || !state.available) return null
  const sleepOn = state.preventIdleSleep.text === 'true'
  const notifyOn = state.notifyOnComplete.text !== 'false'
  const focusPolicy =
    state.notifyFocusPolicy.text === 'always' ? 'always' : 'unfocused'
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="desktopTitle"
      descriptionKey="desktopDescription"
      state={state}
      masterSwitch={booleanMasterSwitch(sleepOn, (value) => {
        props.commit('preventIdleSleep', value)
      })}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <p className={css.note} role="note">{t('desktopPreventIdleHint')}</p>
      <SelectField
        id="settings-general-desktop-notify"
        label={t('desktopNotifyOnComplete')}
        hint={t('desktopNotifyOnCompleteHint')}
        disabled={disabled}
        value={notifyOn ? 'true' : 'false'}
        options={[
          { value: 'true', label: t('desktopNotifyOn') },
          { value: 'false', label: t('desktopNotifyOff') },
        ]}
        onChange={(value) => { props.commit('notifyOnComplete', value) }}
      />
      <SelectField
        id="settings-general-desktop-notify-focus"
        label={t('desktopNotifyFocus')}
        hint={t('desktopNotifyFocusHint')}
        disabled={disabled || !notifyOn}
        value={focusPolicy}
        options={[
          { value: 'unfocused', label: t('desktopNotifyFocusUnfocused') },
          { value: 'always', label: t('desktopNotifyFocusAlways') },
        ]}
        onChange={(value) => { props.commit('notifyFocusPolicy', value) }}
      />
    </PluginCard>
  )
}
