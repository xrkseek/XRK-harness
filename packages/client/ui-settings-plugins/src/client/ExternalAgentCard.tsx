/** External agent binaries card (Face `external-agent`: ACP / app-server / Claude Code). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { ExternalAgentCardFace } from './external-agent-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the external-agent card. */
export type ExternalAgentCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ExternalAgentCardFace>

/** Render the external-agent binaries card. */
export function ExternalAgentCard(props: ExternalAgentCardProps) {
  const { t } = props
  const state = props.useExternalAgentCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="externalAgentTitle"
      descriptionKey="externalAgentDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-external-agent-acp"
        label={t('externalAgentAcp')}
        hint={t('externalAgentAcpHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.acpAgent}
        onEdit={(text) => { props.edit('acpAgent', text) }}
        onReset={() => { props.resetField('acpAgent') }}
      />
      <ValueField
        id="plugin-config-external-agent-app-server"
        label={t('externalAgentAppServer')}
        hint={t('externalAgentAppServerHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.codexAppServer}
        onEdit={(text) => { props.edit('codexAppServer', text) }}
        onReset={() => { props.resetField('codexAppServer') }}
      />
      <ValueField
        id="plugin-config-external-agent-claude-code"
        label={t('externalAgentClaudeCode')}
        hint={t('externalAgentClaudeCodeHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.claudeCode}
        onEdit={(text) => { props.edit('claudeCode', text) }}
        onReset={() => { props.resetField('claudeCode') }}
      />
      <p className={css.note} role="note">{t('externalAgentLiveHint')}</p>
    </PluginCard>
  )
}
