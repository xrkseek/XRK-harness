/** Video generation card (Face `video-gen` Hermes-scale Provider matrix + Credentials). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { VideoGenCardFace } from './video-gen-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

export type VideoGenCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VideoGenCardFace>

const PROVIDER_MODES = new Set([
  'openai',
  'fal',
  'xai',
  'openrouter',
  'deepinfra',
])

/** Render the video-gen card. */
export function VideoGenCard(props: VideoGenCardProps) {
  const { t } = props
  const state = props.useVideoGenCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showProvider = PROVIDER_MODES.has(mode)
  return (
    <PluginCard
      t={t}
      titleKey="videoGenTitle"
      descriptionKey="videoGenDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-video-gen-mode"
        label={t('videoGenMode')}
        hint={t('videoGenModeHint')}
        disabled={disabled}
        value={mode}
        options={[
          { value: 'off', label: t('videoGenModeOff') },
          { value: 'openai', label: t('videoGenModeOpenai') },
          { value: 'fal', label: t('videoGenModeFal') },
          { value: 'xai', label: t('videoGenModeXai') },
          { value: 'openrouter', label: t('videoGenModeOpenrouter') },
          { value: 'deepinfra', label: t('videoGenModeDeepinfra') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showProvider
        ? (
          <>
            {mode === 'openai'
              ? (
                <SecretField
                  id="plugin-config-video-gen-openai-key"
                  label={t('videoGenOpenaiApiKey')}
                  hint={t('videoGenOpenaiApiKeyHint')}
                  disabled={!state.openaiWritable}
                  text={state.openaiApiKey.text}
                  configured={state.openaiConfigured}
                  stateLabel={state.openaiConfigured ? t('videoGenApiKeySet') : t('videoGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('openaiApiKey', text) }}
                />
              )
              : null}
            {mode === 'fal'
              ? (
                <SecretField
                  id="plugin-config-video-gen-fal-key"
                  label={t('videoGenFalApiKey')}
                  hint={t('videoGenFalApiKeyHint')}
                  disabled={!state.falWritable}
                  text={state.falApiKey.text}
                  configured={state.falConfigured}
                  stateLabel={state.falConfigured ? t('videoGenApiKeySet') : t('videoGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('falApiKey', text) }}
                />
              )
              : null}
            {mode === 'xai'
              ? (
                <SecretField
                  id="plugin-config-video-gen-xai-key"
                  label={t('videoGenXaiApiKey')}
                  hint={t('videoGenXaiApiKeyHint')}
                  disabled={!state.xaiWritable}
                  text={state.xaiApiKey.text}
                  configured={state.xaiConfigured}
                  stateLabel={state.xaiConfigured ? t('videoGenApiKeySet') : t('videoGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('xaiApiKey', text) }}
                />
              )
              : null}
            {mode === 'openrouter'
              ? (
                <SecretField
                  id="plugin-config-video-gen-openrouter-key"
                  label={t('videoGenOpenrouterApiKey')}
                  hint={t('videoGenOpenrouterApiKeyHint')}
                  disabled={!state.openrouterWritable}
                  text={state.openrouterApiKey.text}
                  configured={state.openrouterConfigured}
                  stateLabel={state.openrouterConfigured ? t('videoGenApiKeySet') : t('videoGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('openrouterApiKey', text) }}
                />
              )
              : null}
            {mode === 'deepinfra'
              ? (
                <SecretField
                  id="plugin-config-video-gen-deepinfra-key"
                  label={t('videoGenDeepinfraApiKey')}
                  hint={t('videoGenDeepinfraApiKeyHint')}
                  disabled={!state.deepinfraWritable}
                  text={state.deepinfraApiKey.text}
                  configured={state.deepinfraConfigured}
                  stateLabel={state.deepinfraConfigured ? t('videoGenApiKeySet') : t('videoGenApiKeyUnset')}
                  onEdit={(text) => { props.edit('deepinfraApiKey', text) }}
                />
              )
              : null}
            <ValueField
              id="plugin-config-video-gen-base-url"
              label={t('videoGenBaseUrl')}
              hint={t('videoGenBaseUrlHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.baseUrl}
              onEdit={(text) => { props.edit('baseUrl', text) }}
              onReset={() => { props.resetField('baseUrl') }}
            />
            <ValueField
              id="plugin-config-video-gen-model"
              label={t('videoGenModel')}
              hint={t('videoGenModelHint')}
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
      <p className={css.note} role="note">{t('videoGenLiveHint')}</p>
    </PluginCard>
  )
}
