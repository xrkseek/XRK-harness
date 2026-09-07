/** Host plugin inventory registered into Web Settings. */

import type {} from '@xrkseek/client-locale/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-ui-settings/client'
import type { PluginEntryId } from '@xrkseek/xrk-api-remotes/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

function throwRemote(label: string, result: { ok: false; error: { code: string; message: string } }): never {
  throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`)
}

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) throwRemote('pluginInventory.list', result)
    return result.value
  }
  const setEnabled: PluginInventorySettingsTabInjected['setEnabled'] = async (entryId, enabled) => {
    const result = await ctx.remote.pluginInventory.setEnabled(entryId as PluginEntryId, enabled)
    if (!result.ok) throwRemote('pluginInventory.setEnabled', result)
  }
  const remove: PluginInventorySettingsTabInjected['remove'] = async (entryId) => {
    const result = await ctx.remote.pluginInventory.remove(entryId as PluginEntryId)
    if (!result.ok) throwRemote('pluginInventory.remove', result)
  }
  const update: PluginInventorySettingsTabInjected['update'] = async (entryId) => {
    const result = await ctx.remote.pluginInventory.update(entryId as PluginEntryId)
    if (!result.ok) throwRemote('pluginInventory.update', result)
  }
  const open: PluginInventorySettingsTabInjected['open'] = async (entryId) => {
    const result = await ctx.remote.pluginInventory.open(entryId as PluginEntryId)
    if (!result.ok) throwRemote('pluginInventory.open', result)
  }
  const injected = (): PluginInventorySettingsTabInjected => ({ list, setEnabled, remove, update, open })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))
}
