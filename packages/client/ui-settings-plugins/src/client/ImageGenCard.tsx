/** Image generation card (Face `image-gen`: off / openai + Credentials key). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { ImageGenCardFace } from './image-gen-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

export type ImageGenCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ImageGenCardFace>

/** Render the image-gen card. */
export function ImageGenCard(props: ImageGenCardProps) {
  const { t } = props
  const state = props.useImageGenCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showOpenAi = mode === 'openai'
  return (
    <PluginCard
      t={t}
      titleKey="imageGenTitle"
      descriptionKey="imageGenDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-image-gen-mode"
        label={t('imageGenMode')}
        hint={t('imageGenModeHint')}
        disabled={disabled}
        value={mode}
        options={[
          { value: 'off', label: t('imageGenModeOff') },
          { value: 'openai', label: t('imageGenModeOpenai') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showOpenAi
        ? (
          <>
            <SecretField
              id="plugin-config-image-gen-api-key"
              label={t('imageGenApiKey')}
              hint={t('imageGenApiKeyHint')}
              disabled={!state.apiKeyWritable}
              text={state.apiKey.text}
              configured={state.apiKeyConfigured}
              stateLabel={state.apiKeyConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
              onEdit={(text) => { props.edit('apiKey', text) }}
            />
            <ValueField
              id="plugin-config-image-gen-base-url"
              label={t('imageGenBaseUrl')}
              hint={t('imageGenBaseUrlHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.baseUrl}
              onEdit={(text) => { props.edit('baseUrl', text) }}
              onReset={() => { props.resetField('baseUrl') }}
            />
            <ValueField
              id="plugin-config-image-gen-model"
              label={t('imageGenModel')}
              hint={t('imageGenModelHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.model}
              onEdit={(text) => { props.edit('model', text) }}
              onReset={() => { props.resetField('model') }}
            />
          </>
        )
        : null}
      <p className={css.note} role="note">{t('imageGenLiveHint')}</p>
    </PluginCard>
  )
}
