/** Image generation card (Face `image-gen` Hermes-scale Provider matrix + Credentials). */

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

const PROVIDER_MODES = new Set([
  'openai',
  'fal',
  'xai',
  'openrouter',
  'deepinfra',
  'krea',
  'meta-ai',
])

/** Render the image-gen card. */
export function ImageGenCard(props: ImageGenCardProps) {
  const { t } = props
  const state = props.useImageGenCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showProvider = PROVIDER_MODES.has(mode)
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
          { value: 'fal', label: t('imageGenModeFal') },
          { value: 'xai', label: t('imageGenModeXai') },
          { value: 'openrouter', label: t('imageGenModeOpenrouter') },
          { value: 'deepinfra', label: t('imageGenModeDeepinfra') },
          { value: 'krea', label: t('imageGenModeKrea') },
          { value: 'meta-ai', label: t('imageGenModeMeta') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showProvider
        ? (
          <>
            {mode === 'openai'
              ? (
                <SecretField
                  id="plugin-config-image-gen-openai-key"
                  label={t('imageGenOpenaiApiKey')}
                  hint={t('imageGenOpenaiApiKeyHint')}
                  disabled={!state.openaiWritable}
                  text={state.openaiApiKey.text}
                  configured={state.openaiConfigured}
                  stateLabel={state.openaiConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('openaiApiKey', text) }}
                />
              )
              : null}
            {mode === 'fal'
              ? (
                <SecretField
                  id="plugin-config-image-gen-fal-key"
                  label={t('imageGenFalApiKey')}
                  hint={t('imageGenFalApiKeyHint')}
                  disabled={!state.falWritable}
                  text={state.falApiKey.text}
                  configured={state.falConfigured}
                  stateLabel={state.falConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('falApiKey', text) }}
                />
              )
              : null}
            {mode === 'xai'
              ? (
                <SecretField
                  id="plugin-config-image-gen-xai-key"
                  label={t('imageGenXaiApiKey')}
                  hint={t('imageGenXaiApiKeyHint')}
                  disabled={!state.xaiWritable}
                  text={state.xaiApiKey.text}
                  configured={state.xaiConfigured}
                  stateLabel={state.xaiConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('xaiApiKey', text) }}
                />
              )
              : null}
            {mode === 'openrouter'
              ? (
                <SecretField
                  id="plugin-config-image-gen-openrouter-key"
                  label={t('imageGenOpenrouterApiKey')}
                  hint={t('imageGenOpenrouterApiKeyHint')}
                  disabled={!state.openrouterWritable}
                  text={state.openrouterApiKey.text}
                  configured={state.openrouterConfigured}
                  stateLabel={state.openrouterConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('openrouterApiKey', text) }}
                />
              )
              : null}
            {mode === 'deepinfra'
              ? (
                <SecretField
                  id="plugin-config-image-gen-deepinfra-key"
                  label={t('imageGenDeepinfraApiKey')}
                  hint={t('imageGenDeepinfraApiKeyHint')}
                  disabled={!state.deepinfraWritable}
                  text={state.deepinfraApiKey.text}
                  configured={state.deepinfraConfigured}
                  stateLabel={state.deepinfraConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('deepinfraApiKey', text) }}
                />
              )
              : null}
            {mode === 'krea'
              ? (
                <SecretField
                  id="plugin-config-image-gen-krea-key"
                  label={t('imageGenKreaApiKey')}
                  hint={t('imageGenKreaApiKeyHint')}
                  disabled={!state.kreaWritable}
                  text={state.kreaApiKey.text}
                  configured={state.kreaConfigured}
                  stateLabel={state.kreaConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('kreaApiKey', text) }}
                />
              )
              : null}
            {mode === 'meta-ai'
              ? (
                <SecretField
                  id="plugin-config-image-gen-meta-key"
                  label={t('imageGenMetaApiKey')}
                  hint={t('imageGenMetaApiKeyHint')}
                  disabled={!state.metaWritable}
                  text={state.metaApiKey.text}
                  configured={state.metaConfigured}
                  stateLabel={state.metaConfigured ? t('imageGenApiKeySet') : t('imageGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('metaApiKey', text) }}
                />
              )
              : null}
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
