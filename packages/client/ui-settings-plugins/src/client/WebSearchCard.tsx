/** Web search provider card (Face `web-search` namespace + Credentials). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WebSearchCardFace } from './web-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the web-search card. */
export type WebSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebSearchCardFace>

/**
 * Render the web-search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebSearchCard(props: WebSearchCardProps) {
  const { t } = props
  const state = props.useWebSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="webSearchTitle"
      descriptionKey="webSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-web-search-provider"
        label={t('webSearchProvider')}
        hint={t('webSearchProviderHint')}
        disabled={disabled}
        value={state.provider.text || 'auto'}
        options={[
          { value: 'auto', label: t('webSearchProviderAuto') },
          { value: 'tavily', label: t('webSearchProviderTavily') },
          { value: 'brave', label: t('webSearchProviderBrave') },
          { value: 'parallel-free', label: t('webSearchProviderParallel') },
          { value: 'duckduckgo', label: t('webSearchProviderDuckduckgo') },
        ]}
        onChange={(value) => { props.edit('provider', value) }}
      />
      <SecretField
        id="plugin-config-web-search-tavily"
        label={t('webSearchTavilyKey')}
        hint={t('webSearchTavilyKeyHint')}
        disabled={!state.tavilyWritable}
        text={state.tavilyApiKey.text}
        configured={state.tavilyConfigured}
        stateLabel={state.tavilyConfigured ? t('webSearchKeySet') : t('webSearchKeyUnset')}
        onEdit={(text) => { props.edit('tavilyApiKey', text) }}
      />
      <SecretField
        id="plugin-config-web-search-brave"
        label={t('webSearchBraveKey')}
        hint={t('webSearchBraveKeyHint')}
        disabled={!state.braveWritable}
        text={state.braveApiKey.text}
        configured={state.braveConfigured}
        stateLabel={state.braveConfigured ? t('webSearchKeySet') : t('webSearchKeyUnset')}
        onEdit={(text) => { props.edit('braveApiKey', text) }}
      />
      <ValueField
        id="plugin-config-web-search-region"
        label={t('webSearchRegion')}
        hint={t('webSearchRegionHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.region}
        onEdit={(text) => { props.edit('region', text) }}
        onReset={() => { props.resetField('region') }}
      />
    </PluginCard>
  )
}
