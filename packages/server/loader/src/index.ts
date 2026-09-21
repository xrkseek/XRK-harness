import { loadDiscoveryHit } from "./load.js";
import {
  failureFromLoadError,
  throwIfRequiredPluginFailures,
  type PluginLoadFailure,
  type ReconcileProcessPluginsResult,
} from "./load-failures.js";
import { scanPluginDir, type DiscoveryHit } from "./manifest.js";
import {
  isPluginSoftDisabledAt,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
} from "./managed-state.js";
import type { RegisteredPlugin } from "./types.js";

export type {
  RegisteredPlugin,
  PluginPromptSection,
  PluginCommand,
  PluginCommandContext,
  PluginCommandResult,
  PluginChannelDescriptor,
  HostWireContext,
  HostPublicHandlerFn,
} from "./types.js";
export type { DiscoveryHit, PluginManifest } from "./manifest.js";
export { scanPluginDir } from "./manifest.js";
export { loadPluginModule, loadDiscoveryHit, stubFromManifest } from "./load.js";
export {
  PLUGIN_KINDS,
  RESERVED_PLUGIN_KINDS,
  isKnownPluginKind,
  type KnownPluginKind,
} from "./kinds.js";
export {
  applyToolsPlugins,
  isToolsPlugin,
  wireCompositionTools,
  type AppliedPluginTool,
  type ApplyToolsPluginsResult,
  type SkippedPluginTool,
} from "./tools.js";
export {
  applyPromptPlugins,
  isPromptPlugin,
  wireCompositionPrompts,
  type AppliedPluginPrompt,
  type ApplyPromptPluginsResult,
  type SkippedPluginPrompt,
} from "./prompt.js";
export {
  collectPluginCommands,
  isCommandsPlugin,
} from "./commands.js";
export {
  toPluginInventoryEntries,
  type PluginFiberPhase,
  type PluginInventoryEntry,
} from "./inventory.js";
export {
  collectPolicyRules,
  applyPolicyPlugins,
  isPolicyPlugin,
  wireCompositionPolicy,
  composeHostPolicyEngine,
  createPolicyEngineFromPlugins,
  type AppliedPluginPolicyRule,
} from "./policy.js";
export {
  applyHooksPlugins,
  isHooksPlugin,
  wireCompositionHooks,
  type AppliedPluginHook,
  type PluginToolHooks,
} from "./hooks.js";
export {
  createShellHookPre,
  defaultShellHookPaths,
  loadShellHookCommands,
  parsePreToolUseHooks,
  toolNameMatches,
  DEFAULT_SHELL_HOOK_TIMEOUT_MS,
  type CreateShellHookPreOptions,
  type ShellHookCommand,
  type ShellHookRunResult,
  type ShellHookRunner,
} from "./shell-hooks.js";
export {
  createLifecycleWebhookNotifier,
  defaultLifecycleWebhookPaths,
  loadLifecycleWebhooks,
  parseLifecycleWebhooks,
  DEFAULT_LIFECYCLE_WEBHOOK_TIMEOUT_MS,
  type CreateLifecycleWebhookNotifierOptions,
  type LifecycleWebhookEventName,
  type LifecycleWebhookFetch,
  type LifecycleWebhookNotifier,
  type LifecycleWebhookPayload,
  type LifecycleWebhookTarget,
} from "./lifecycle-webhooks.js";
export {
  collectChannelPlugins,
  collectChannelPluginRegistrations,
  isChannelPlugin,
  wireCompositionChannels,
  type AppliedPluginChannel,
  type PluginChannelRegistration,
} from "./channel.js";
export {
  applyLlmPlugins,
  collectLlmBrands,
  createProviderRegistryFromPlugins,
  isLlmPlugin,
  wireCompositionLlm,
  type AppliedPluginLlmBrand,
  type ApplyLlmPluginsResult,
  type SkippedPluginLlmBrand,
} from "./llm.js";
export { isHostPlugin, listHostPlugins } from "./host.js";
export { atomicWriteText } from "./atomic-write.js";
export {
  DISABLED_PLUGINS_FILE,
  MANAGED_PLUGINS_INVENTORY_FILE,
  canonicalizeDisabledPluginIdsAt,
  clearSoftDisabledIdsAt,
  disabledPluginsPath,
  isPluginSoftDisabledAt,
  lookupManagedPluginSourceAt,
  managedPluginsInventoryPath,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  readManagedPluginPackagesAt,
  reconcileManagedProcessPlugins,
  setSoftDisabledAt,
  writeDisabledPluginIdsAt,
  RequiredPluginLoadError,
  throwIfRequiredPluginFailures,
  type ManagedPackageIndex,
  type ManagedPluginPackageMeta,
  type PluginLoadFailure,
  type ReconcileProcessPluginsResult,
  type SoftDisableReconcileLoader,
} from "./managed-state.js";
export type {
  PluginLoadFailure as ProcessPluginLoadFailure,
} from "./load-failures.js";
export {
  StartupError,
  formatStartupDiagnostic,
  entriesFromPluginFailures,
  isPendingServiceMessage,
  missingServicesFromMessage,
  startupErrorFromUnknown,
  type StartupEntryDiagnostic,
  type StartupFailureOutcome,
} from "./startup-audit.js";
export {
  checkPluginRegisterUnloadPair,
  type PluginRegisterUnloadPair,
} from "./load-failures.js";

export interface PluginLoader {
  register(plugin: RegisteredPlugin): void;
  unregister(id: string): Promise<void>;
  /**
   * Drop registration without calling `dispose` (Host defers MCP client
   * teardown while a drain still holds mid-turn tool handles).
   */
  detach(id: string): RegisteredPlugin | undefined;
  list(): readonly RegisteredPlugin[];
  /**
   * Scan `dir` for plugin manifests (`xrk.plugin.json` or
   * `package.json` plugin fields). Does not import modules.
   */
  discover(dir: string): Promise<readonly DiscoveryHit[]>;
  /** Import one discovery hit and register it (Cordis stubs skip import). */
  load(hit: DiscoveryHit): Promise<RegisteredPlugin>;
  /**
   * Discover + load + register every plugin under `dir`.
   * Skips ids already registered and soft-disabled managed ids (same disk
   * contract as {@link reconcileManagedProcessPlugins}). Optional load
   * failures are isolated; `required: true` failures throw
   * {@link RequiredPluginLoadError}. Returns `{ ids, failures }`.
   */
  loadAll(dir: string): Promise<ReconcileProcessPluginsResult>;
}

export function createPluginLoader(): PluginLoader {
  const plugins = new Map<string, RegisteredPlugin>();
  return {
    register(plugin) {
      if (plugins.has(plugin.id)) {
        throw new Error(`plugin already registered: ${plugin.id}`);
      }
      plugins.set(plugin.id, plugin);
    },
    async unregister(id) {
      const p = plugins.get(id);
      if (!p) return;
      // Always drop the registration so unload pairs with dispose even when
      // dispose throws (resource leak vs stuck registry — prefer unload).
      try {
        await p.dispose?.();
      } finally {
        plugins.delete(id);
      }
    },
    detach(id) {
      const p = plugins.get(id);
      if (!p) return undefined;
      plugins.delete(id);
      return p;
    },
    list() {
      return [...plugins.values()];
    },
    async discover(dir) {
      return scanPluginDir(dir);
    },
    async load(hit) {
      const plugin = await loadDiscoveryHit(hit);
      if (plugins.has(plugin.id)) {
        throw new Error(`plugin already registered: ${plugin.id}`);
      }
      plugins.set(plugin.id, plugin);
      return plugin;
    },
    async loadAll(dir) {
      const root = dir;
      const hits = await scanPluginDir(root);
      const disabled = readDisabledPluginIdsAt(root);
      const index = readManagedPackageIndexAt(root);
      const ids: string[] = [];
      const failures: PluginLoadFailure[] = [];
      for (const hit of hits) {
        if (plugins.has(hit.manifest.id)) continue;
        // Soft-disabled managed packages (incl. skipLoad cordis stubs) must
        // not reappear as live inventory ghosts via loadAll.
        if (isPluginSoftDisabledAt(hit.manifest.id, disabled, index)) continue;
        try {
          const plugin = await loadDiscoveryHit(hit);
          plugins.set(plugin.id, plugin);
          ids.push(plugin.id);
        } catch (err) {
          failures.push(
            failureFromLoadError(
              hit.manifest.id,
              hit.manifest.required === true,
              err,
            ),
          );
        }
      }
      throwIfRequiredPluginFailures(failures);
      return { ids, failures };
    },
  };
}
