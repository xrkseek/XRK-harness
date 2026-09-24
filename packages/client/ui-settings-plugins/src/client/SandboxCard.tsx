/** Exec sandbox card (Face `sandbox`: backend · docker · windows mode). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { SandboxCardFace } from './sandbox-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the sandbox card. */
export type SandboxCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SandboxCardFace>

/**
 * Render the exec-sandbox card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function SandboxCard(props: SandboxCardProps) {
  const { t } = props
  const state = props.useSandboxCard(snapshot => snapshot)
  const disabled = !state.writable
  const backend = state.backend.text || 'workspace'
  const showDocker = backend === 'docker'
  const showWindows = backend === 'windows'
  return (
    <PluginCard
      t={t}
      titleKey="sandboxTitle"
      descriptionKey="sandboxDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-sandbox-backend"
        label={t('sandboxBackend')}
        hint={t('sandboxBackendHint')}
        disabled={disabled}
        value={backend}
        options={[
          { value: 'workspace', label: t('sandboxBackendWorkspace') },
          { value: 'docker', label: t('sandboxBackendDocker') },
          { value: 'bwrap', label: t('sandboxBackendBwrap') },
          { value: 'windows', label: t('sandboxBackendWindows') },
        ]}
        onChange={(value) => { props.edit('backend', value) }}
      />
      {showDocker
        ? (
          <>
            <ValueField
              id="plugin-config-sandbox-docker-image"
              label={t('sandboxDockerImage')}
              hint={t('sandboxDockerImageHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.dockerImage}
              onEdit={(text) => { props.edit('dockerImage', text) }}
              onReset={() => { props.resetField('dockerImage') }}
            />
            <SelectField
              id="plugin-config-sandbox-docker-network"
              label={t('sandboxDockerNetwork')}
              hint={t('sandboxDockerNetworkHint')}
              disabled={disabled}
              value={state.dockerNetwork.text || 'none'}
              options={[
                { value: 'none', label: t('sandboxDockerNetworkNone') },
                { value: 'bridge', label: t('sandboxDockerNetworkBridge') },
              ]}
              onChange={(value) => { props.edit('dockerNetwork', value) }}
            />
          </>
        )
        : null}
      {showWindows
        ? (
          <SelectField
            id="plugin-config-sandbox-windows-mode"
            label={t('sandboxWindowsMode')}
            hint={t('sandboxWindowsModeHint')}
            disabled={disabled}
            value={state.windowsMode.text || 'workspace-write'}
            options={[
              { value: 'workspace-write', label: t('sandboxWindowsModeWorkspaceWrite') },
              { value: 'read-only', label: t('sandboxWindowsModeReadOnly') },
              { value: 'danger-full-access', label: t('sandboxWindowsModeDanger') },
            ]}
            onChange={(value) => { props.edit('windowsMode', value) }}
          />
        )
        : null}
      <p className={css.note} role="note">{t('sandboxLiveHint')}</p>
    </PluginCard>
  )
}
