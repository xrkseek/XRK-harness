/** The agent loop's card: how many tool calls one step may run at once. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { AgentLoopCardFace } from './agent-loop-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the agent-loop card. */
export type AgentLoopCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<AgentLoopCardFace>

/**
 * Render the agent-loop card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function AgentLoopCard(props: AgentLoopCardProps) {
  const { t } = props
  const state = props.useAgentLoopCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="agentLoopTitle"
      descriptionKey="agentLoopDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-agent-loop-parallel"
        label={t('agentLoopMaxParallel')}
        hint={t('agentLoopMaxParallelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxParallelToolCalls}
        onEdit={(text) => { props.edit('maxParallelToolCalls', text) }}
        onReset={() => { props.resetField('maxParallelToolCalls') }}
      />
      <ValueField
        id="plugin-config-agent-loop-max-steps"
        label={t('agentLoopMaxSteps')}
        hint={t('agentLoopMaxStepsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxSteps}
        onEdit={(text) => { props.edit('maxSteps', text) }}
        onReset={() => { props.resetField('maxSteps') }}
      />
      <ValueField
        id="plugin-config-agent-loop-tool-settle"
        label={t('agentLoopToolSettle')}
        hint={t('agentLoopToolSettleHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={!state.writable}
        {...state.toolSettle}
        onEdit={(text) => { props.edit('toolSettle', text) }}
        onReset={() => { props.resetField('toolSettle') }}
      />
      <ValueField
        id="plugin-config-agent-loop-llm-retry"
        label={t('agentLoopLlmRetry')}
        hint={t('agentLoopLlmRetryHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.llmRetryMaxRetries}
        onEdit={(text) => { props.edit('llmRetryMaxRetries', text) }}
        onReset={() => { props.resetField('llmRetryMaxRetries') }}
      />
    </PluginCard>
  )
}
