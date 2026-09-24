/** Memory embed sidecar card (Face `memory-embed`) on Plugins → Advanced. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { MemoryEmbedCardFace } from './memory-embed-card-controller.ts'
import type {} from './advanced-slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the memory-embed card. */
export type MemoryEmbedCardProps =
  PropsRuntime<'settings.plugin.advanced.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<MemoryEmbedCardFace>

/** Render the memory-embed sidecar card. */
export function MemoryEmbedCard(props: MemoryEmbedCardProps) {
  const { t } = props
  const state = props.useMemoryEmbedCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="memoryEmbedTitle"
      descriptionKey="memoryEmbedDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-advanced-memory-embed-url"
        label={t('memoryEmbedUrl')}
        hint={t('memoryEmbedUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.url}
        onEdit={(text) => { props.edit('url', text) }}
        onReset={() => { props.resetField('url') }}
      />
      <ValueField
        id="plugin-advanced-memory-embed-collection"
        label={t('memoryEmbedCollection')}
        hint={t('memoryEmbedCollectionHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.collection}
        onEdit={(text) => { props.edit('collection', text) }}
        onReset={() => { props.resetField('collection') }}
      />
      <SecretField
        id="plugin-advanced-memory-embed-token"
        label={t('memoryEmbedToken')}
        hint={t('memoryEmbedTokenHint')}
        disabled={!state.tokenWritable}
        text={state.token.text}
        configured={state.tokenConfigured}
        stateLabel={state.tokenConfigured
          ? t('memoryEmbedTokenSet')
          : t('memoryEmbedTokenUnset')}
        onEdit={(text) => { props.edit('token', text) }}
      />
      <p className={css.note} role="note">{t('memoryEmbedLiveHint')}</p>
    </PluginCard>
  )
}
