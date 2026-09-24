/** Session telemetry card (Face `session-telemetry`: off / memory / OTLP). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { TelemetryCardFace } from './telemetry-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the telemetry card. */
export type TelemetryCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<TelemetryCardFace>

/**
 * Render the session-telemetry card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function TelemetryCard(props: TelemetryCardProps) {
  const { t } = props
  const state = props.useTelemetryCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showEndpoint = mode === 'otlp'
  return (
    <PluginCard
      t={t}
      titleKey="telemetryTitle"
      descriptionKey="telemetryDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-session-telemetry-mode"
        label={t('telemetryMode')}
        hint={t('telemetryModeHint')}
        disabled={disabled}
        value={mode}
        options={[
          { value: 'off', label: t('telemetryModeOff') },
          { value: 'memory', label: t('telemetryModeMemory') },
          { value: 'otlp', label: t('telemetryModeOtlp') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showEndpoint
        ? (
          <ValueField
            id="plugin-config-session-telemetry-endpoint"
            label={t('telemetryEndpoint')}
            hint={t('telemetryEndpointHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            disabled={disabled}
            {...state.endpoint}
            onEdit={(text) => { props.edit('endpoint', text) }}
            onReset={() => { props.resetField('endpoint') }}
          />
        )
        : null}
      <p className={css.note} role="note">{t('telemetryRestartHint')}</p>
    </PluginCard>
  )
}
