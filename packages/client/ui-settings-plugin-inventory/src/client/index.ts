/** Host plugin inventory registered into Web Settings. */

import type {} from '@xrkseek/client-locale/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-ui-settings/client'
import type { PluginEntryId } from '@xrkseek/xrk-api-remotes/client'
import type {} from '@xrkseek/xrk-api-remotes/types'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import {
  clearPluginClientRefreshHint,
  markPluginClientRefreshHint,
} from './plugin-install-ui-session.ts'
import {
  applyOverlayBootPlan,
  normalizeOverlayUrls,
  overlayRevMap,
  type ClientBootOverlay,
  type OverlayBootSessionState,
} from './soft-remount.ts'
import { en, ja, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInstallLog } from './plugin-install-ui-session.ts'
export type { PluginInventoryLocaleKey } from './locales.ts'
export {
  applyOverlayBootPlan,
  planOverlayRemount,
  ensureOverlayUrlRev,
  overlayRevMap,
  normalizeOverlayUrls,
  softRemountClientOverlay,
  softUnloadClientOverlay,
} from './soft-remount.ts'

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

type OverlayBootSession = OverlayBootSessionState & {
  chain: Promise<void>
}

function createOverlayBootSession(): OverlayBootSession {
  return {
    lastRevs: new Map(),
    unloadPending: false,
    chain: Promise.resolve(),
  }
}

function enqueueOverlayBoot(session: OverlayBootSession, task: () => Promise<void>): void {
  session.chain = session.chain.then(
    () => task().catch(() => {
      // Keep the queue alive; hint is set by the task on failure paths.
    }),
    () => task().catch(() => undefined),
  )
}

/**
 * Apply Host overlay boot: soft remount on grow/reload; soft unload on shrink.
 * App-lifetime — runs even when the Plugins tab is closed.
 */
async function handleOverlayBootChanged(
  ctx: ClientContext,
  session: OverlayBootSession,
): Promise<void> {
  const result = await ctx.remote.pluginInventory.clientBoot()
  if (!result.ok) {
    markPluginClientRefreshHint('generic')
    return
  }
  const overlay = normalizeOverlayUrls(result.value as ClientBootOverlay)
  const applied = await applyOverlayBootPlan(ctx, session, overlay)
  if (applied.remountFailed) {
    markPluginClientRefreshHint('remount')
    return
  }
  if (applied.unloadFailed) {
    markPluginClientRefreshHint('unload')
    return
  }
  if (!session.unloadPending) clearPluginClientRefreshHint()
}

async function seedOverlayRevs(
  ctx: ClientContext,
  session: OverlayBootSession,
): Promise<void> {
  const result = await ctx.remote.pluginInventory.clientBoot()
  if (!result.ok) return
  // Only seed when no boot-changed has landed yet.
  if (session.lastRevs.size > 0) return
  session.lastRevs = overlayRevMap(normalizeOverlayUrls(result.value as ClientBootOverlay))
}

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja }), 'ui-settings-plugin-inventory: dictionaries')

  // Soft remount lives at plugin apply lifetime (not tab mount).
  // Per-apply session avoids leaked module globals across remounts.
  const overlaySession = createOverlayBootSession()
  ctx.effect(() => {
    enqueueOverlayBoot(overlaySession, () => seedOverlayRevs(ctx, overlaySession))
    return ctx.remote.$on('plugin-inventory/boot-changed', () => {
      enqueueOverlayBoot(overlaySession, () => handleOverlayBootChanged(ctx, overlaySession))
    })
  }, 'ui-settings-plugin-inventory: overlay soft remount')

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
  const update: PluginInventorySettingsTabInjected['update'] = async (
    entryId,
    requestId,
    registry,
    proxy,
  ) => {
    const reg = registry !== undefined && registry.trim().length > 0 ? registry.trim() : undefined
    const prox = proxy !== undefined && proxy.trim().length > 0 ? proxy.trim() : undefined
    const result = await ctx.remote.pluginInventory.update(
      entryId as PluginEntryId,
      requestId,
      reg,
      prox,
    )
    if (!result.ok) {
      const details = result.error.details as {
        command?: unknown
        output?: unknown
        exitCode?: unknown
      } | undefined
      const commandParts = ['xrkh plugin add']
      if (reg) commandParts.push('--registry', reg)
      if (prox) commandParts.push('--proxy', prox)
      commandParts.push(`${entryId}@latest`)
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
            command: commandParts.join(' '),
            output: result.error.message,
            exitCode: 1,
          }
      const error = new Error(`${result.error.code}: ${result.error.message}`) as Error & {
        installLog: typeof log
      }
      error.installLog = log
      throw error
    }
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
  const install: PluginInventorySettingsTabInjected['install'] = async (
    spec,
    registry,
    requestId,
    proxy,
  ) => {
    const reg = registry !== undefined && registry.trim().length > 0 ? registry.trim() : undefined
    const prox = proxy !== undefined && proxy.trim().length > 0 ? proxy.trim() : undefined
    const result = await ctx.remote.pluginInventory.install(spec, reg, requestId, prox)
    if (!result.ok) {
      const details = result.error.details as {
        command?: unknown
        output?: unknown
        exitCode?: unknown
      } | undefined
      const commandParts = ['xrkh plugin add']
      if (reg) commandParts.push('--registry', reg)
      if (prox) commandParts.push('--proxy', prox)
      commandParts.push(spec)
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
            command: commandParts.join(' '),
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
  const subscribeUpdatesChanged: PluginInventorySettingsTabInjected['subscribeUpdatesChanged'] = (
    onChanged,
  ) => ctx.remote.$on('plugin-inventory/updates-changed', () => {
    onChanged()
  })
  // Tab only refreshes the inventory list; soft remount is apply()-lifetime.
  const subscribeBootChanged: PluginInventorySettingsTabInjected['subscribeBootChanged'] = (
    onChanged,
  ) => ctx.remote.$on('plugin-inventory/boot-changed', () => {
    onChanged()
  })
  const open: PluginInventorySettingsTabInjected['open'] = async (entryId) => {
    const result = await ctx.remote.pluginInventory.open(entryId as PluginEntryId)
    if (!result.ok) throwRemote('pluginInventory.open', result)
  }
  const checkUpdates: PluginInventorySettingsTabInjected['checkUpdates'] = async (
    entryIds,
    force,
    registry,
    proxy,
  ) => {
    const reg = registry !== undefined && registry.trim().length > 0 ? registry.trim() : undefined
    const prox = proxy !== undefined && proxy.trim().length > 0 ? proxy.trim() : undefined
    const result = await ctx.remote.pluginInventory.checkUpdates(
      entryIds as PluginEntryId[] | undefined,
      force,
      reg,
      prox,
    )
    if (!result.ok) throwRemote('pluginInventory.checkUpdates', result)
    return result.value
  }
  const injected = (): PluginInventorySettingsTabInjected => ({
    list,
    setEnabled,
    remove,
    update,
    reload,
    install,
    subscribeInstallLog,
    subscribeUpdatesChanged,
    subscribeBootChanged,
    open,
    checkUpdates,
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
