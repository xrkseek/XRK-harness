/** ASR (speech-to-text) Host card: composer dictation + engine setup. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { useEffect } from 'react'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { AsrCardFace } from './asr-card-controller.ts'
import { VoiceLocalBlock } from './VoiceLocalBlock.tsx'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the ASR card. */
export type AsrCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<AsrCardFace>

/** Render the ASR Host card. */
export function AsrCard(props: AsrCardProps) {
  const { t } = props
  // Readiness is resolved when the card opens, not when the plugin applied:
  // the Face voice namespace mounts after the `remote` service the fiber
  // waited for, so the apply-time probe can be a frame too early.
  const { refreshLocal } = props
  useEffect(() => { refreshLocal() }, [refreshLocal])
  const state = props.useAsrCard(snapshot => snapshot)
  const disabled = !state.writable
  const enabled = state.enabled.text === 'true'
  // The engine decides which half of the card is useful: a download block for
  // SenseVoice, or endpoint + key for a cloud gateway.
  const engine = state.engine.text || 'local'
  return (
    <PluginCard
      t={t}
      titleKey="asrTitle"
      descriptionKey="asrDescription"
      state={state}
      masterSwitch={booleanMasterSwitch(enabled, (value) => { props.edit('enabled', value) })}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-asr-engine"
        label={t('asrEngine')}
        hint={t('asrEngineHint')}
        disabled={disabled}
        value={engine}
        options={[
          { value: 'local', label: t('asrEngineLocal') },
          { value: 'openai', label: t('asrEngineCloud') },
        ]}
        onChange={(value) => { props.edit('engine', value) }}
      />
      {engine === 'local'
        ? (
          <>
            <VoiceLocalBlock
              local={state.local}
              disabled={disabled}
              refreshLocal={props.refreshLocal}
              prepareLocal={props.prepareLocal}
              cancelLocal={props.cancelLocal}
              transcribeLocal={props.transcribeLocal}
              t={t}
            />
            {/* Opt-in, never guessed: on a filtered network the model CDN can
                answer the user's browser but not this Host, and a proxy is the
                only setting that bridges the two. */}
            <ValueField
              id="plugin-config-asr-download-proxy"
              label={t('voiceDownloadProxy')}
              hint={t('voiceDownloadProxyHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.downloadProxy}
              onEdit={(text) => { props.edit('downloadProxy', text) }}
              onReset={() => { props.resetField('downloadProxy') }}
            />
          </>
        )
        : null}
      {engine === 'openai'
        ? (
          <>
            <SecretField
              id="plugin-config-asr-api-key"
              label={t('voiceApiKey')}
              hint={t('voiceApiKeyHint')}
              disabled={!state.apiKeyWritable}
              text={state.apiKey.text}
              configured={state.apiKeyConfigured}
              stateLabel={state.apiKeyConfigured ? t('voiceApiKeySet') : t('voiceApiKeyUnset')}
              onEdit={(text) => { props.edit('apiKey', text) }}
            />
            {state.keyMissing
              ? <p className={css.invalid} role="status">{t('asrKeyMissing')}</p>
              : null}
            <ValueField
              id="plugin-config-asr-base-url"
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
          </>
        )
        : null}
      <p className={css.note} role="note">{t('asrComposerHint')}</p>
      <p className={css.note} role="note">{t('voiceWakeDeferred')}</p>
    </PluginCard>
  )
}
