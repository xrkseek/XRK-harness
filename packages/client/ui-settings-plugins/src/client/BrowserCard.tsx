/** Page browser_* card (Face `browser`: agent-browser / HTTP snapshot / CDP). */

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
  const mode = state.mode.text || 'agent-browser'
  const showCdp = mode === 'cdp'
  const showAgent = mode === 'agent-browser'
  // Schema defaults: headed=true, restore=true, autoConnect=false, browserBinary=auto.
  const headed = state.headed.text === 'false' ? 'false' : 'true'
  const restore = state.restore.text === 'false' ? 'false' : 'true'
  const autoConnect = state.autoConnect.text === 'true' ? 'true' : 'false'
  const browserBinary = state.browserBinary.text || 'auto'
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
          { value: 'agent-browser', label: t('browserModeAgentBrowser') },
          { value: 'http', label: t('browserModeHttp') },
          { value: 'cdp', label: t('browserModeCdp') },
        ]}
        onChange={(value) => {
          props.edit('mode', value)
          props.save()
        }}
      />
      {showAgent
        ? (
          <>
            <SelectField
              id="plugin-config-browser-binary"
              label={t('browserBinary')}
              hint={t('browserBinaryHint')}
              disabled={disabled}
              value={browserBinary}
              options={[
                { value: 'auto', label: t('browserBinaryAuto') },
                { value: 'edge', label: t('browserBinaryEdge') },
                { value: 'chrome', label: t('browserBinaryChrome') },
                { value: 'bundled', label: t('browserBinaryBundled') },
              ]}
              onChange={(value) => {
                props.edit('browserBinary', value)
                props.save()
              }}
            />
            <SelectField
              id="plugin-config-browser-headed"
              label={t('browserHeaded')}
              hint={t('browserHeadedHint')}
              disabled={disabled}
              value={headed}
              options={[
                { value: 'false', label: t('browserHeadedOff') },
                { value: 'true', label: t('browserHeadedOn') },
              ]}
              onChange={(value) => {
                props.edit('headed', value)
                props.save()
              }}
            />
            <SelectField
              id="plugin-config-browser-restore"
              label={t('browserRestore')}
              hint={t('browserRestoreHint')}
              disabled={disabled}
              value={restore}
              options={[
                { value: 'true', label: t('browserRestoreOn') },
                { value: 'false', label: t('browserRestoreOff') },
              ]}
              onChange={(value) => {
                props.edit('restore', value)
                props.save()
              }}
            />
            <SelectField
              id="plugin-config-browser-auto-connect"
              label={t('browserAutoConnect')}
              hint={t('browserAutoConnectHint')}
              disabled={disabled}
              value={autoConnect}
              options={[
                { value: 'false', label: t('browserAutoConnectOff') },
                { value: 'true', label: t('browserAutoConnectOn') },
              ]}
              onChange={(value) => {
                props.edit('autoConnect', value)
                props.save()
              }}
            />
            <ValueField
              id="plugin-config-browser-executable"
              label={t('browserExecutablePath')}
              hint={t('browserExecutablePathHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.executablePath}
              onEdit={(text) => { props.edit('executablePath', text) }}
              onReset={() => { props.resetField('executablePath') }}
            />
            <ValueField
              id="plugin-config-browser-chrome-args"
              label={t('browserChromeArgs')}
              hint={t('browserChromeArgsHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.chromeArgs}
              onEdit={(text) => { props.edit('chromeArgs', text) }}
              onReset={() => { props.resetField('chromeArgs') }}
            />
            <ValueField
              id="plugin-config-browser-profile"
              label={t('browserProfile')}
              hint={t('browserProfileHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.profile}
              onEdit={(text) => { props.edit('profile', text) }}
              onReset={() => { props.resetField('profile') }}
            />
            <ValueField
              id="plugin-config-browser-proxy"
              label={t('browserProxy')}
              hint={t('browserProxyHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.proxy}
              onEdit={(text) => { props.edit('proxy', text) }}
              onReset={() => { props.resetField('proxy') }}
            />
            <ValueField
              id="plugin-config-browser-state-path"
              label={t('browserStatePath')}
              hint={t('browserStatePathHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...state.statePath}
              onEdit={(text) => { props.edit('statePath', text) }}
              onReset={() => { props.resetField('statePath') }}
            />
            <p className={css.note} role="note">{t('browserChromeInstallHint')}</p>
            <p className={css.note} role="note">{t('browserLoginReuseHint')}</p>
          </>
        )
        : null}
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
