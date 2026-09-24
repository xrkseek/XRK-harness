/** Video generation card (Face `video-gen`: off / openai + Credentials key). */

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

/** Render the video-gen card. */
export function VideoGenCard(props: VideoGenCardProps) {
  const { t } = props
  const state = props.useVideoGenCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showOpenAi = mode === 'openai'
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
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showOpenAi
        ? (
          <>
            <SecretField
              id="plugin-config-video-gen-api-key"
              label={t('videoGenApiKey')}
              hint={t('videoGenApiKeyHint')}
              disabled={!state.apiKeyWritable}
              text={state.apiKey.text}
              configured={state.apiKeyConfigured}
              stateLabel={state.apiKeyConfigured ? t('videoGenApiKeySet') : t('videoGenApiKeyUnset')}
              onEdit={(text) => { props.edit('apiKey', text) }}
            />
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
