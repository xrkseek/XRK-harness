/** Settings → Plugins card for workspace_list discovery window. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WorkspaceDiscoveryCardFace } from './workspace-discovery-card-controller.ts'
import type {} from './slot-contract.ts'

export type WorkspaceDiscoveryCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WorkspaceDiscoveryCardFace>

export function WorkspaceDiscoveryCard(props: WorkspaceDiscoveryCardProps) {
  const { t } = props
  const state = props.useWorkspaceDiscoveryCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="workspaceDiscoveryTitle"
      descriptionKey="workspaceDiscoveryDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-workspace-discovery-window"
        label={t('workspaceDiscoveryActiveWindowHours')}
        hint={t('workspaceDiscoveryActiveWindowHoursHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.activeWindowHours}
        onEdit={(text) => { props.edit('activeWindowHours', text) }}
        onReset={() => { props.resetField('activeWindowHours') }}
      />
      <ValueField
        id="plugin-config-workspace-discovery-max-active"
        label={t('workspaceDiscoveryMaxActive')}
        hint={t('workspaceDiscoveryMaxActiveHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxActiveItems}
        onEdit={(text) => { props.edit('maxActiveItems', text) }}
        onReset={() => { props.resetField('maxActiveItems') }}
      />
      <ValueField
        id="plugin-config-workspace-discovery-max-list"
        label={t('workspaceDiscoveryMaxList')}
        hint={t('workspaceDiscoveryMaxListHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxListItems}
        onEdit={(text) => { props.edit('maxListItems', text) }}
        onReset={() => { props.resetField('maxListItems') }}
      />
    </PluginCard>
  )
}
