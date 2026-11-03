/** TTS (text-to-speech) Host card: the agent's `text_to_speech` tool. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { useEffect } from 'react'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { TtsCardFace } from './tts-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the TTS card. */
export type TtsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<TtsCardFace>

/** Render the TTS Host card. */
export function TtsCard(props: TtsCardProps) {
  const { t } = props
  // Same rule as the ASR card: the voice namespace may land after apply, so the
  // OS voice catalog is re-read whenever the card opens.
  const { refreshVoices } = props
  useEffect(() => { refreshVoices() }, [refreshVoices])
  const state = props.useTtsCard(snapshot => snapshot)
  const disabled = !state.writable
  const enabled = state.enabled.text === 'true'
  const engine = state.engine.text || 'local'
  const catalog = state.voices.voices
  // Keep a stored voice selectable even when the Host no longer lists it: a
  // silent fallback to "default" would rewrite the user's pick on save.
  const storedVoice = state.voice.text
  const voiceOptions = [
    { value: '', label: t('ttsVoiceDefault') },
    ...catalog.map(voice => ({ value: voice.id, label: voice.label })),
    ...(storedVoice !== '' && !catalog.some(voice => voice.id === storedVoice)
      ? [{ value: storedVoice, label: storedVoice }]
      : []),
  ]
  return (
    <PluginCard
      t={t}
      titleKey="ttsTitle"
      descriptionKey="ttsDescription"
      state={state}
      masterSwitch={booleanMasterSwitch(enabled, (value) => { props.edit('enabled', value) })}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-tts-engine"
        label={t('ttsEngine')}
        hint={t('ttsEngineHint')}
        disabled={disabled}
        value={engine}
        options={[
          { value: 'local', label: t('ttsEngineLocal') },
          { value: 'openai', label: t('ttsEngineCloud') },
        ]}
        onChange={(value) => { props.edit('engine', value) }}
      />
      {engine === 'local'
        ? (
          <>
            {catalog.length > 0
              ? (
                <SelectField
                  id="plugin-config-tts-voice-local"
                  label={t('ttsVoice')}
                  hint={t('ttsLocalVoiceHint')}
                  disabled={disabled}
                  value={storedVoice}
                  options={voiceOptions}
                  onChange={(value) => { props.edit('voice', value) }}
                />
              )
              : (
                <>
                  <ValueField
                    id="plugin-config-tts-voice-local"
                    label={t('ttsVoice')}
                    hint={t('ttsLocalVoiceHint')}
                    overriddenLabel={t('overridden')}
                    resetLabel={t('reset')}
                    invalidLabel={t('invalidNumber')}
                    disabled={disabled}
                    {...state.voice}
                    onEdit={(text) => { props.edit('voice', text) }}
                    onReset={() => { props.resetField('voice') }}
                  />
                  <p className={css.note} role="note">
                    {state.voices.loading ? t('ttsVoicesLoading') : t('ttsVoicesEmpty')}
                  </p>
                  <button
                    type="button"
                    className={css.oauthLink}
                    onClick={props.refreshVoices}
                  >
                    {t('ttsVoicesRetry')}
                  </button>
                </>
              )}
          </>
        )
        : (
          <>
            <SecretField
              id="plugin-config-tts-api-key"
              label={t('voiceApiKey')}
              hint={t('ttsSharedKeyHint')}
              disabled={!state.apiKeyWritable}
              text={state.apiKey.text}
              configured={state.apiKeyConfigured}
              stateLabel={state.apiKeyConfigured ? t('voiceApiKeySet') : t('voiceApiKeyUnset')}
              onEdit={(text) => { props.edit('apiKey', text) }}
            />
            {state.keyMissing
              ? <p className={css.invalid} role="status">{t('ttsKeyMissing')}</p>
              : null}
            <ValueField
              id="plugin-config-tts-base-url"
              label={t('voiceBaseUrl')}
              hint={t('voiceBaseUrlHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.baseUrl}
              onEdit={(text) => { props.edit('baseUrl', text) }}
              onReset={() => { props.resetField('baseUrl') }}
            />
            <ValueField
              id="plugin-config-tts-voice"
              label={t('ttsVoice')}
              hint={t('ttsVoiceHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.voice}
              onEdit={(text) => { props.edit('voice', text) }}
              onReset={() => { props.resetField('voice') }}
            />
            <ValueField
              id="plugin-config-tts-model"
              label={t('ttsModel')}
              hint={t('ttsModelHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.model}
              onEdit={(text) => { props.edit('model', text) }}
              onReset={() => { props.resetField('model') }}
            />
          </>
        )}
      <p className={css.note} role="note">{t('ttsToolHint')}</p>
    </PluginCard>
  )
}
