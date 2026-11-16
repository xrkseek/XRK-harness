/** Settings → Plugins card for workspace_list / peer / sibling discovery. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ChoiceField, ValueField } from './fields.tsx'
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
  const onOff = [
    { value: 'true', label: t('workspaceDiscoveryOn') },
    { value: 'false', label: t('workspaceDiscoveryOff') },
  ] as const
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
      <ChoiceField
        id="plugin-config-workspace-discovery-prefer-same"
        label={t('workspaceDiscoveryPreferSame')}
        hint={t('workspaceDiscoveryPreferSameHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        options={onOff}
        {...state.preferSameWorkspace}
        onEdit={(text) => { props.edit('preferSameWorkspace', text) }}
        onReset={() => { props.resetField('preferSameWorkspace') }}
      />
      <ChoiceField
        id="plugin-config-workspace-discovery-peer"
        label={t('workspaceDiscoveryPeerSessions')}
        hint={t('workspaceDiscoveryPeerSessionsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        options={onOff}
        {...state.peerSessionDiscovery}
        onEdit={(text) => { props.edit('peerSessionDiscovery', text) }}
        onReset={() => { props.resetField('peerSessionDiscovery') }}
      />
      <ChoiceField
        id="plugin-config-workspace-discovery-sibling"
        label={t('workspaceDiscoverySiblingScope')}
        hint={t('workspaceDiscoverySiblingScopeHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        options={[
          { value: 'same-delegator', label: t('workspaceDiscoverySiblingSame') },
          { value: 'none', label: t('workspaceDiscoverySiblingNone') },
        ]}
        {...state.siblingScope}
        onEdit={(text) => { props.edit('siblingScope', text) }}
        onReset={() => { props.resetField('siblingScope') }}
      />
      <ValueField
        id="plugin-config-workspace-discovery-max-depth"
        label={t('workspaceDiscoveryMaxDepth')}
        hint={t('workspaceDiscoveryMaxDepthHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxDepth}
        onEdit={(text) => { props.edit('maxDepth', text) }}
        onReset={() => { props.resetField('maxDepth') }}
      />
    </PluginCard>
  )
}
