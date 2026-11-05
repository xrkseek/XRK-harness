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
  // catalog is re-read whenever the card opens or the engine changes (Edge
  // answers a different catalog than the OS backends).
  const { refreshVoices } = props
  const state = props.useTtsCard(snapshot => snapshot)
  const disabled = !state.writable
  const enabled = state.enabled.text === 'true'
  const engine = state.engine.text || 'edge'
  useEffect(() => { refreshVoices(engine) }, [refreshVoices, engine])
  const catalog = state.voices.voices
  // Edge names a locale per voice, so the card can offer one row per language.
  // OS backends leave `locale` unset; everything then lands in the zh row,
  // which is the historical single-list behavior.
  const zhCatalog = catalog.filter(voice => voice.locale?.startsWith('zh') ?? true)
  const enCatalog = catalog.filter(voice => voice.locale?.startsWith('en') ?? false)
  // Keep a stored voice selectable even when the catalog is empty / failed /
  // the Host no longer lists it — never rewrite the user's pick to "".
  const storedVoice = state.voice.text
  const storedVoiceEn = state.voiceEn.text
  const voiceOptions = (rows: readonly { id: string; label: string }[], stored: string) => {
    const preserved = stored !== '' && !rows.some(voice => voice.id === stored)
      ? [{ value: stored, label: stored }]
      : []
    return [
      { value: '', label: t('ttsVoiceDefault') },
      ...rows.map(voice => ({ value: voice.id, label: voice.label })),
      ...preserved,
    ]
  }
  const refreshControl = (
    <button
      type="button"
      className={css.oauthLink}
      disabled={disabled || state.voices.loading || state.saving}
      onClick={() => { props.saveAndRefreshVoices() }}
    >
      {state.voices.loading ? t('ttsVoicesLoading') : t('ttsVoicesRetry')}
    </button>
  )
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
          { value: 'edge', label: t('ttsEngineEdge') },
          { value: 'local', label: t('ttsEngineLocal') },
          { value: 'openai', label: t('ttsEngineCloud') },
        ]}
        onChange={(value) => {
          props.edit('engine', value)
          // A voice id is engine-scoped: an Edge shortName (`zh-CN-XiaoxiaoNeural`)
          // means nothing to SAPI, and an OS voice name means nothing to an
          // OpenAI gateway. Carrying it across engines stored a pick the user
          // never made — the old silent SAPI fallback then spoke a different
          // voice than the card showed. Clearing both lets the new engine use
          // its own default; the user picks again if they care.
          props.edit('voice', '')
          props.edit('voiceEn', '')
        }}
      />
      <SelectField
        id="plugin-config-tts-language"
        label={t('ttsLanguage')}
        hint={t('ttsLanguageHint')}
        disabled={disabled}
        value={state.language.text || 'auto'}
        options={[
          { value: 'auto', label: t('ttsLanguageAuto') },
          { value: 'zh', label: t('ttsLanguageZh') },
          { value: 'en', label: t('ttsLanguageEn') },
        ]}
        onChange={(value) => { props.edit('language', value) }}
      />
      {engine === 'edge'
        ? (
          <>
            <ValueField
              id="plugin-config-tts-proxy"
              label={t('ttsProxy')}
              hint={t('ttsProxyHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.proxy}
              onEdit={(text) => { props.edit('proxy', text) }}
              onReset={() => { props.resetField('proxy') }}
            />
            <SelectField
              id="plugin-config-tts-voice-zh"
              label={t('ttsVoiceZh')}
              hint={t('ttsEdgeVoiceHint')}
              disabled={disabled}
              value={storedVoice}
              options={voiceOptions(zhCatalog, storedVoice)}
              onChange={(value) => { props.edit('voice', value) }}
            />
            <SelectField
              id="plugin-config-tts-voice-en"
              label={t('ttsVoiceEn')}
              hint={t('ttsEdgeVoiceHint')}
              disabled={disabled}
              value={storedVoiceEn}
              options={voiceOptions(enCatalog, storedVoiceEn)}
              onChange={(value) => { props.edit('voiceEn', value) }}
            />
            {catalog.length === 0
              ? (
                <p className={css.note} role="note">
                  {state.voices.loading ? t('ttsVoicesLoading') : t('ttsVoicesEmptyEdge')}
                  {' '}
                  {refreshControl}
                </p>
              )
              : (
                <p className={css.note} role="note">{refreshControl}</p>
              )}
          </>
        )
        : engine === 'local'
        ? (
          <>
            {/* Always keep SelectField when a voice is already stored — an empty
                catalog (probe failed) must not demote the pick to a free-text
                blank that looks like「引擎默认」and risks clearing on save. */}
            {catalog.length > 0 || storedVoice !== ''
              ? (
                <SelectField
                  id="plugin-config-tts-voice-local"
                  label={t('ttsVoice')}
                  hint={t('ttsLocalVoiceHint')}
                  disabled={disabled}
                  value={storedVoice}
                  options={voiceOptions(catalog, storedVoice)}
                  onChange={(value) => { props.edit('voice', value) }}
                />
              )
              : (
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
              )}
            {catalog.length === 0
              ? (
                <p className={css.note} role="note">
                  {state.voices.loading ? t('ttsVoicesLoading') : t('ttsVoicesEmpty')}
                  {' '}
                  <button
                    type="button"
                    className={css.oauthLink}
                    disabled={disabled || state.voices.loading}
                    onClick={() => { props.refreshVoices() }}
                  >
                    {t('ttsVoicesRetry')}
                  </button>
                </p>
              )
              : null}
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
            <ValueField
              id="plugin-config-tts-proxy-cloud"
              label={t('ttsProxy')}
              hint={t('ttsProxyHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.proxy}
              onEdit={(text) => { props.edit('proxy', text) }}
              onReset={() => { props.resetField('proxy') }}
            />
          </>
        )}
      <p className={css.note} role="note">{t('ttsToolHint')}</p>
    </PluginCard>
  )
}
