/** The agent loop's card: how many tool calls one step may run at once. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ChoiceField, ValueField } from './fields.tsx'
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
      <ChoiceField
        id="plugin-config-agent-loop-auto-continue"
        label={t('agentLoopAutoContinue')}
        hint={t('agentLoopAutoContinueHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        value={state.autoContinueOnMaxTokens.text}
        overridden={state.autoContinueOnMaxTokens.overridden}
        invalid={state.autoContinueOnMaxTokens.invalid}
        disabled={!state.writable}
        options={[
          { value: 'true', label: t('agentLoopAutoContinueOn') },
          { value: 'false', label: t('agentLoopAutoContinueOff') },
        ]}
        onChange={(text) => { props.edit('autoContinueOnMaxTokens', text) }}
        onReset={() => { props.resetField('autoContinueOnMaxTokens') }}
      />
      <ValueField
        id="plugin-config-agent-loop-auto-continue-rounds"
        label={t('agentLoopAutoContinueMaxRounds')}
        hint={t('agentLoopAutoContinueMaxRoundsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.autoContinueMaxRounds}
        onEdit={(text) => { props.edit('autoContinueMaxRounds', text) }}
        onReset={() => { props.resetField('autoContinueMaxRounds') }}
      />
      <ValueField
        id="plugin-config-agent-loop-tool-order"
        label={t('agentLoopToolOrder')}
        hint={t('agentLoopToolOrderHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('agentLoopToolOrderInvalid')}
        disabled={!state.writable}
        {...state.toolOrder}
        onEdit={(text) => { props.edit('toolOrder', text) }}
        onReset={() => { props.resetField('toolOrder') }}
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
      <ValueField
        id="plugin-config-agent-loop-max-request-tokens"
        label={t('agentLoopMaxRequestTokens')}
        hint={t('agentLoopMaxRequestTokensHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxRequestTokens}
        onEdit={(text) => { props.edit('maxRequestTokens', text) }}
        onReset={() => { props.resetField('maxRequestTokens') }}
      />
      <ValueField
        id="plugin-config-agent-loop-keep-tokens"
        label={t('agentLoopKeepTokens')}
        hint={t('agentLoopKeepTokensHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.keepTokens}
        onEdit={(text) => { props.edit('keepTokens', text) }}
        onReset={() => { props.resetField('keepTokens') }}
      />
      <ValueField
        id="plugin-config-agent-loop-buffer-tokens"
        label={t('agentLoopBufferTokens')}
        hint={t('agentLoopBufferTokensHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.bufferTokens}
        onEdit={(text) => { props.edit('bufferTokens', text) }}
        onReset={() => { props.resetField('bufferTokens') }}
      />
      <ChoiceField
        id="plugin-config-agent-loop-compaction-strategy"
        label={t('agentLoopCompactionStrategy')}
        hint={t('agentLoopCompactionStrategyHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('agentLoopCompactionStrategyInvalid')}
        value={state.compactionStrategy.text}
        overridden={state.compactionStrategy.overridden}
        invalid={state.compactionStrategy.invalid}
        disabled={!state.writable}
        options={[
          { value: 'prune-summary', label: t('agentLoopCompactionPruneSummary') },
          { value: 'prune-only', label: t('agentLoopCompactionPruneOnly') },
          { value: 'summary-only', label: t('agentLoopCompactionSummaryOnly') },
          { value: 'off', label: t('agentLoopCompactionOff') },
        ]}
        onChange={(text) => { props.edit('compactionStrategy', text) }}
        onReset={() => { props.resetField('compactionStrategy') }}
      />
      <ValueField
        id="plugin-config-agent-loop-tool-result-inline"
        label={t('agentLoopToolResultMaxInline')}
        hint={t('agentLoopToolResultMaxInlineHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.toolResultMaxInlineBytes}
        onEdit={(text) => { props.edit('toolResultMaxInlineBytes', text) }}
        onReset={() => { props.resetField('toolResultMaxInlineBytes') }}
      />
      <ValueField
        id="plugin-config-agent-loop-max-subagent-depth"
        label={t('agentLoopMaxSubagentDepth')}
        hint={t('agentLoopMaxSubagentDepthHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxSubagentDepth}
        onEdit={(text) => { props.edit('maxSubagentDepth', text) }}
        onReset={() => { props.resetField('maxSubagentDepth') }}
      />
      <ValueField
        id="plugin-config-agent-loop-max-active-subagents"
        label={t('agentLoopMaxActiveSubagents')}
        hint={t('agentLoopMaxActiveSubagentsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxActiveSubagents}
        onEdit={(text) => { props.edit('maxActiveSubagents', text) }}
        onReset={() => { props.resetField('maxActiveSubagents') }}
      />
    </PluginCard>
  )
}
