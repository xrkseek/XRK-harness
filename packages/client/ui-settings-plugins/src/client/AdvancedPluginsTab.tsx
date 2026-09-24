/**
 * Advanced Host plugins contributed to Plugins → Advanced.
 * Same dispatch model as ConfigurablePluginsTab, over `settings.plugin.advanced.item`.
 * Shipped cards: auto-review · memory-embed.
 */

import { Fragment } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@xrkseek/client-ui-slots'
import type {} from './advanced-slot-contract.ts'
import type { AdvancedPluginsTabFace } from './advanced-tab-store.ts'
import css from './PluginsSettingsSection.module.css'

/** Props the renderer binds for the advanced tab. */
export type AdvancedPluginsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugin.advanced.item'>
  & InjectFace<AdvancedPluginsTabFace>

/**
 * Render advanced cards registered by plugins.
 * @param props - locale copy, slot rendering, and the namespaces to dispatch.
 * @returns the card list, or the empty line once the Host has answered.
 */
export function AdvancedPluginsTab(props: AdvancedPluginsTabProps) {
  const { t, renderSlot } = props
  const { loaded, namespaces } = props.useAdvancedPlugins(snapshot => snapshot)
  if (namespaces.length > 0) {
    return (
      <ul className={css.cards}>
        {namespaces.map(ns => (
          <Fragment key={ns}>
            {renderSlot('settings.plugin.advanced.item', {}, { entryKey: ns })}
          </Fragment>
        ))}
      </ul>
    )
  }
  return loaded ? <p className={css.empty}>{t('advancedEmpty')}</p> : null
}
