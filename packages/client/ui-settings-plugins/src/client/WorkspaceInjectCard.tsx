/** Workspace inject budget: how many characters of rules/skills enter the prompt. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WorkspaceInjectCardFace } from './workspace-inject-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the workspace-inject card. */
export type WorkspaceInjectCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WorkspaceInjectCardFace>

/**
 * Render the workspace-inject card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WorkspaceInjectCard(props: WorkspaceInjectCardProps) {
  const { t } = props
  const state = props.useWorkspaceInjectCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="workspaceInjectTitle"
      descriptionKey="workspaceInjectDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-workspace-inject-max-chars"
        label={t('workspaceInjectMaxChars')}
        hint={t('workspaceInjectMaxCharsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.injectMaxChars}
        onEdit={(text) => { props.edit('injectMaxChars', text) }}
        onReset={() => { props.resetField('injectMaxChars') }}
      />
    </PluginCard>
  )
}
