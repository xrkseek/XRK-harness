/** Voice Host card (Face `voice`: off / openai + Credentials key). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { modeMasterSwitch } from './plugin-master-switch.ts'
import type { VoiceCardFace } from './voice-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the voice card. */
export type VoiceCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VoiceCardFace>

/** Render the voice Host card. */
export function VoiceCard(props: VoiceCardProps) {
  const { t } = props
  const state = props.useVoiceCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showOpenAi = mode === 'openai'
  return (
    <PluginCard
      t={t}
      titleKey="voiceTitle"
      descriptionKey="voiceDescription"
      state={state}
      masterSwitch={modeMasterSwitch(mode, (value) => { props.edit('mode', value) }, 'openai')}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-voice-mode"
        label={t('voiceMode')}
        hint={t('voiceModeHint')}
        disabled={disabled}
        value={mode}
        options={[
          { value: 'off', label: t('voiceModeOff') },
          { value: 'openai', label: t('voiceModeOpenai') },
          { value: 'local', label: t('voiceModeLocal') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {mode === 'local'
        ? <p className={css.note} role="note">{t('voiceLocalHint')}</p>
        : null}
      {showOpenAi
        ? (
          <>
            <SecretField
              id="plugin-config-voice-api-key"
              label={t('voiceApiKey')}
              hint={t('voiceApiKeyHint')}
              disabled={!state.apiKeyWritable}
              text={state.apiKey.text}
              configured={state.apiKeyConfigured}
              stateLabel={state.apiKeyConfigured ? t('voiceApiKeySet') : t('voiceApiKeyUnset')}
              onEdit={(text) => { props.edit('apiKey', text) }}
            />
            {state.keyMissing
              ? <p className={css.invalid} role="status">{t('voiceKeyMissing')}</p>
              : null}
            <ValueField
              id="plugin-config-voice-base-url"
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
      <SelectField
        id="plugin-config-voice-speak-tools"
        label={t('voiceSpeakTools')}
        hint={t('voiceSpeakToolsHint')}
        disabled={disabled}
        value={state.speakTools.text || 'false'}
        options={[
          { value: 'false', label: t('voiceSpeakToolsOff') },
          { value: 'true', label: t('voiceSpeakToolsOn') },
        ]}
        onChange={(value) => { props.edit('speakTools', value) }}
      />
      <p className={css.note} role="note">{t('voiceLiveHint')}</p>
      <p className={css.note} role="note">{t('voiceWakeDeferred')}</p>
    </PluginCard>
  )
}
