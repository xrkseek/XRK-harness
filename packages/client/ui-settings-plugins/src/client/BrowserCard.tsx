/** Page browser_* card (Face `browser`: HTTP snapshot / CDP URL). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { BrowserCardFace } from './browser-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the browser card. */
export type BrowserCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<BrowserCardFace>

/**
 * Render the browser session card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function BrowserCard(props: BrowserCardProps) {
  const { t } = props
  const state = props.useBrowserCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'http'
  const showCdp = mode === 'cdp'
  return (
    <PluginCard
      t={t}
      titleKey="browserTitle"
      descriptionKey="browserDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-browser-mode"
        label={t('browserMode')}
        hint={t('browserModeHint')}
        disabled={disabled}
        value={mode}
        options={[
          { value: 'http', label: t('browserModeHttp') },
          { value: 'cdp', label: t('browserModeCdp') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showCdp
        ? (
          <ValueField
            id="plugin-config-browser-cdp-url"
            label={t('browserCdpUrl')}
            hint={t('browserCdpUrlHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            disabled={disabled}
            {...state.cdpUrl}
            onEdit={(text) => { props.edit('cdpUrl', text) }}
            onReset={() => { props.resetField('cdpUrl') }}
          />
        )
        : null}
      <p className={css.note} role="note">{t('browserLiveHint')}</p>
    </PluginCard>
  )
}
