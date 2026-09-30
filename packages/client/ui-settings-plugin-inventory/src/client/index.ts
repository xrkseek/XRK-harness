/** Host plugin inventory registered into Web Settings. */

import type {} from '@xrkseek/client-locale/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-ui-settings/client'
import type { PluginEntryId } from '@xrkseek/xrk-api-remotes/client'
import type {} from '@xrkseek/xrk-api-remotes/types'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInstallLog } from './plugin-install-ui-session.ts'
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
    if (
      typeof result.value.command === 'string'
      && typeof result.value.output === 'string'
      && typeof result.value.exitCode === 'number'
    ) {
      return {
        command: result.value.command,
        output: result.value.output,
        exitCode: result.value.exitCode,
      }
    }
    return undefined
  }
  const reload: PluginInventorySettingsTabInjected['reload'] = async (entryId) => {
    const result = await ctx.remote.pluginInventory.reload(entryId as PluginEntryId)
    if (!result.ok) throwRemote('pluginInventory.reload', result)
  }
  const install: PluginInventorySettingsTabInjected['install'] = async (spec, registry, requestId) => {
    const reg = registry !== undefined && registry.trim().length > 0 ? registry.trim() : undefined
    const result = await ctx.remote.pluginInventory.install(spec, reg, requestId)
    if (!result.ok) {
      const details = result.error.details as {
        command?: unknown
        output?: unknown
        exitCode?: unknown
      } | undefined
      const log =
        details !== undefined &&
        typeof details.command === 'string' &&
        typeof details.output === 'string' &&
        typeof details.exitCode === 'number'
          ? {
            command: details.command,
            output: details.output,
            exitCode: details.exitCode,
          }
          : {
            command: reg
              ? `xrkh plugin add --registry ${reg} ${spec}`
              : `xrkh plugin add ${spec}`,
            output: result.error.message,
            exitCode: 1,
          }
      const error = new Error(`${result.error.code}: ${result.error.message}`) as Error & {
        installLog: typeof log
      }
      error.installLog = log
      throw error
    }
    return {
      command: result.value.command,
      output: result.value.output,
      exitCode: result.value.exitCode,
    }
  }
  const subscribeInstallLog: PluginInventorySettingsTabInjected['subscribeInstallLog'] = (
    requestId,
    onText,
  ) => ctx.remote.$on('plugin-inventory/install-log', (id, _stream, text) => {
    if (id !== requestId) return
    onText(text)
  })
  const open: PluginInventorySettingsTabInjected['open'] = async (entryId) => {
    const result = await ctx.remote.pluginInventory.open(entryId as PluginEntryId)
    if (!result.ok) throwRemote('pluginInventory.open', result)
  }
  const injected = (): PluginInventorySettingsTabInjected => ({
    list,
    setEnabled,
    remove,
    update,
    reload,
    install,
    subscribeInstallLog,
    open,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))
}
