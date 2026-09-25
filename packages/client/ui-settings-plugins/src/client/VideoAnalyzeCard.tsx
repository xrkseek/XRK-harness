/** Video analyze card (Face `video-analyze`: off / openai + Credentials key). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { VideoAnalyzeCardFace } from './video-analyze-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

export type VideoAnalyzeCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VideoAnalyzeCardFace>

/** Render the video-analyze card. */
export function VideoAnalyzeCard(props: VideoAnalyzeCardProps) {
  const { t } = props
  const state = props.useVideoAnalyzeCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showOpenAi = mode === 'openai'
  return (
    <PluginCard
      t={t}
      titleKey="videoAnalyzeTitle"
      descriptionKey="videoAnalyzeDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-video-analyze-mode"
        label={t('videoAnalyzeMode')}
        hint={t('videoAnalyzeModeHint')}
        disabled={disabled}
        value={mode}
        options={[
          { value: 'off', label: t('videoAnalyzeModeOff') },
          { value: 'openai', label: t('videoAnalyzeModeOpenai') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showOpenAi
        ? (
          <>
            <SecretField
              id="plugin-config-video-analyze-api-key"
              label={t('videoAnalyzeApiKey')}
              hint={t('videoAnalyzeApiKeyHint')}
              disabled={!state.apiKeyWritable}
              text={state.apiKey.text}
              configured={state.apiKeyConfigured}
              stateLabel={state.apiKeyConfigured ? t('videoAnalyzeApiKeySet') : t('videoAnalyzeApiKeyUnset')}
              onEdit={(text) => { props.edit('apiKey', text) }}
            />
            <ValueField
              id="plugin-config-video-analyze-base-url"
              label={t('videoAnalyzeBaseUrl')}
              hint={t('videoAnalyzeBaseUrlHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.baseUrl}
              onEdit={(text) => { props.edit('baseUrl', text) }}
              onReset={() => { props.resetField('baseUrl') }}
            />
            <ValueField
              id="plugin-config-video-analyze-model"
              label={t('videoAnalyzeModel')}
              hint={t('videoAnalyzeModelHint')}
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
      <p className={css.note} role="note">{t('videoAnalyzeLiveHint')}</p>
      <p className={css.note} role="note">{t('videoAnalyzeBoundaryHint')}</p>
    </PluginCard>
  )
}
