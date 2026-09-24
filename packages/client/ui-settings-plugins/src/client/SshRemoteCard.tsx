/** SSH remote workspace card (Face `ssh-remote`) on General Settings. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { SshRemoteCardFace } from './ssh-remote-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the SSH remote card. */
export type SshRemoteCardProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SshRemoteCardFace>

/**
 * Render the SSH remote workspace card (General 「远程」).
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function SshRemoteCard(props: SshRemoteCardProps) {
  const { t } = props
  const state = props.useSshRemoteCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="sshRemoteTitle"
      descriptionKey="sshRemoteDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="settings-general-ssh-remote-host"
        label={t('sshRemoteHost')}
        hint={t('sshRemoteHostHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.host}
        onEdit={(text) => { props.edit('host', text) }}
        onReset={() => { props.resetField('host') }}
      />
      <ValueField
        id="settings-general-ssh-remote-workspace"
        label={t('sshRemoteWorkspace')}
        hint={t('sshRemoteWorkspaceHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.workspace}
        onEdit={(text) => { props.edit('workspace', text) }}
        onReset={() => { props.resetField('workspace') }}
      />
      <ValueField
        id="settings-general-ssh-remote-user"
        label={t('sshRemoteUser')}
        hint={t('sshRemoteUserHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.user}
        onEdit={(text) => { props.edit('user', text) }}
        onReset={() => { props.resetField('user') }}
      />
      <ValueField
        id="settings-general-ssh-remote-port"
        label={t('sshRemotePort')}
        hint={t('sshRemotePortHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.port}
        onEdit={(text) => { props.edit('port', text) }}
        onReset={() => { props.resetField('port') }}
      />
      <ValueField
        id="settings-general-ssh-remote-key"
        label={t('sshRemoteKeyPath')}
        hint={t('sshRemoteKeyPathHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.keyPath}
        onEdit={(text) => { props.edit('keyPath', text) }}
        onReset={() => { props.resetField('keyPath') }}
      />
      <p className={css.note} role="note">{t('sshRemoteRestartHint')}</p>
    </PluginCard>
  )
}
