import type { AgentHandle, AgentRunResult } from "@xrkseek/core-agent";
import type { LlmAdapter } from "@xrkseek/llm";
import { createLocalAttachmentStore, resolveLocalAttachmentsRoot } from "@xrkseek/attachment-local";
import {
  createMemorySessionStore,
  createPersistentSessionStore,
  createSessionDrainHub,
  newSession,
  readSessionEvents,
  SessionsDirInUseError,
  type SessionDrainHub,
  type SessionStore,
} from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { loadPolicyRulesetFile } from "@xrkseek/policy";
import { flattenText, isHumanUserMessageSource } from "@xrkseek/protocol";
import {
  effectiveSandboxMode,
  shouldConfineSandbox,
} from "@xrkseek/protocol";
import {
  consolidateCuratedMemoryPhase1,
  consolidateCuratedMemoryPhase2,
  resolveMemoryProvider,
  type MemoryProvider,
} from "@xrkseek/exec-memory";
import { runSkillCurator } from "@xrkseek/workspace";
import { resolveSecretStore } from "@xrkseek/secrets";
import { hostSettingsPath, defaultSpillDir, resolveXrkHome, type HostConfig } from "@xrkseek/server-config";
import { installOutboundHttpProxy } from "./http-proxy.js";
import { mountInvariantsFailFast } from "./invariants-fail-fast.js";
import { watchPolicyFile } from "./policy-file-watch.js";
import { createA2aInboundPublicHandler } from "./a2a-inbound-public.js";
import {
  applyXrkProductBootPolicy,
  chainPublicHandlers,
  ensureDshCompatHostPlugin,
  createLiveHostPluginsPublicHandler,
  createHttpServer,
  createXrkPluginPublicHandler,
  createSidebarPublicHandler,
  prewarmDshCompatAdapters,
  shutdownDshCompatServices,
  applyHostPackageByName,
  stopHostPackageFiber,
  listHostAppliedPackages,
  invokeDshCompatRpc,
  attachDshCompatUpgrades,
  DSH_SETTINGS_NAMESPACES,
  DSH_SETTINGS_DEFAULTS,
  runPluginMutate,
  type HarnessHttpServer,
  type DshCompatOptions,
  ensureXrkPlatformClientBootEntries,
  injectBootIntoHtml,
  injectMobileAccessShellIntoHtml,
  loadBootManifestFromWebDist,
  mergeWebBootManifests,
  resolveWebBootManifest,
  createXrkWalletPort,
  createMobileAccessGateChecker,
  createMobileAccessGateHandler,
  loadSidebarPrefs,
} from "@xrkseek/server-http";
import {
  attachFaceUpgrades,
  bindSubagentTools,
  bindSessionQueryTools,
  createFaceRuntime,
  effectiveHostApiKey,
  isLoopbackAddress,
  listCredentialSlots,
  peekSettingsYamlSection,
  publishRemoteEvent,
  createSessionRoutingLlm,
  liveRouteAllowsImageInput,
  resolveSessionCwd,
  canonicalAgentPresetId,
  resolveAgentPresetProfile,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_ACTIVE_CHILDREN,
  tryHandleFaceHttp,
  isPluginSoftDisabledAt,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  reconcileManagedProcessPlugins,
  snapshotSessionWorkspace,
  SNAPSHOT_DRAIN_BUDGET_MS,
  type FaceApprovalBroker,
  type FaceQuestionBroker,
  type FaceRuntime,
} from "@xrkseek/server-face";
import {
  createPluginLoader,
  composeHostPolicyEngine,
  wireCompositionChannels,
  wireCompositionLlm,
  collectChannelPluginRegistrations,
  type PluginLoader,
  type RegisteredPlugin,
} from "@xrkseek/server-loader";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { createHostAgentCache } from "./agent-cache.js";
import { createHostCron, type CronScheduler } from "@xrkseek/server-cron";
import { AsyncLocalStorage } from "node:async_hooks";
import { wireDrainStatus, publishDrainIdle, type SessionDrainControl } from "./drain-status.js";
import { attachSidebarPtyUpgrades } from "./sidebar-pty.js";
import { AgentOpenRegistry } from "./sidebar-agent-opens.js";
import { AgentPtyRegistry } from "./sidebar-agent-pty.js";
import { createSshDirectoryBackend } from "./ssh-directory-backend.js";
import { bindSidebarAgentTools } from "./sidebar-agent-tools.js";
import { createUsageStatsBridgeFromFace } from "./usage-stats-bridge.js";
import { createCostMeterUsageBridge } from "./cost-meter-bridge.js";
import { createHarnessConnectorBridgeFromFace } from "./harness-connector-bridge.js";
import { createAutoReviewBridgeFromHost } from "./auto-review-bridge.js";
import { createWalletFaceBridgeFromFace } from "./wallet-bridge.js";
import { createSidebarFaceBridgeFromFace } from "./sidebar-face-bridge.js";
import {
  mcpDraftsToSpecs,
  parseMcpServersEnv,
  readMcpAllowFromHostSettings,
  readMcpServersFromHostSettings,
  reconcileMcpToolPlugins,
  type McpServerDraft,
  type McpServerSpec,
} from "./mcp-wire.js";
import { createMcpDeferredDispose } from "./mcp-deferred-dispose.js";
import { createStandingToolRegistry } from "./standing-tools.js";
import { createDefaultPtyAccess } from "@xrkseek/exec-pty";
import { createLocalShell } from "@xrkseek/exec-shell";
import {
  createSandboxStack,
  parseSandboxProduct,
  type SandboxService,
} from "@xrkseek/exec-sandbox";
import { createBrowserRuntimeRegistry, setOutboundAllowlistAuditObserver } from "@xrkseek/exec-web";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import {
  resolveExecEnvironment,
  type ExecWorld,
} from "@xrkseek/exec-environment";
import {
  createSshExecutionWorldReady,
  resolveSshConfig,
  type SshExecutionWorld,
} from "@xrkseek/exec-ssh";
import type { HostLogger, HostSpawnOptions } from "./log.js";

/** True while an unattended cron agent turn is running — skip cron tools to avoid recursion. */
const cronAgentDepth = new AsyncLocalStorage<boolean>();

export { createHostAgentCache, HOST_PLUGINS_KEY } from "./agent-cache.js";
export type { InvalidateAllOpts } from "./agent-cache.js";
export { createStandingToolRegistry } from "./standing-tools.js";
export type { AgentResolveOpts, HostAgentCache } from "./agent-cache.js";
export type { HostLogger, HostSpawnOptions } from "./log.js";
export {
  a2aInboundSessionId,
  createA2aInboundPublicHandler,
  resolveA2aInboundEnabled,
  type A2aInboundProductSettings,
} from "./a2a-inbound-public.js";
export {
  loadMcpToolPlugins,
  mcpDraftsToSpecs,
  mcpFingerprint,
  parseMcpServersEnv,
  readMcpAllowFromHostSettings,
  readMcpServersFromHostSettings,
  reconcileMcpToolPlugins,
  resetLastGoodHostMcpWireCaches,
  type McpRegisteredPlugin,
  type McpServerDraft,
  type McpServerSpec,
  type ReconcileMcpResult,
} from "./mcp-wire.js";

/**
 * AbortError with a readable reason. Used by the session drain snapshot race
 * so a cancellation that interrupts a stuck git/fs call surfaces as a normal
 * AbortError instead of a bare string or DOMException mismatch.
 */
function hostAbortError(reason?: unknown): Error {
  const err = new Error(reason === undefined ? "aborted" : String(reason));
  err.name = "AbortError";
  return err;
}

function logMcpReconcile(
  log: HostLogger | undefined,
  label: string,
  result: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly kept: readonly string[];
    readonly parked: readonly string[];
    readonly failures: readonly { serverName: string; message: string }[];
  },
): void {
  if (!log) return;
  const parkBit =
    result.parked.length > 0 ? ` park=${result.parked.length}` : "";
  log.info(
    `mcp ${label}: +${result.added.length} -${result.removed.length} keep=${result.kept.length}${parkBit}`,
  );
  for (const id of result.added) log.info(`mcp connected ${id}`);
  for (const id of result.removed) log.info(`mcp removed ${id}`);
  if (result.parked.length > 0) {
    log.info(
      `mcp parked ${result.parked.join(", ")} (enable Allow connect in Settings > Plugins > MCP)`,
    );
  }
  for (const f of result.failures) {
    log.warn(`mcp connect failed ${f.serverName}: ${f.message}`);
  }
}

async function resolveWebPluginOverlay(
  pluginsDir: string | undefined,
): Promise<string | undefined> {
  if (!pluginsDir) return undefined;
  const overlay = path.resolve(pluginsDir, "web");
  try {
    await access(overlay);
    return overlay;
  } catch {
    return undefined;
  }
}

/** Env/config MCP list (empty → Face host-settings.json is the source). */
function configuredMcpSpecs(config: HostConfig): readonly McpServerSpec[] {
  const fromConfig = config.runtime.mcpServers;
  if (fromConfig && fromConfig.length > 0) {
    return mcpDraftsToSpecs(fromConfig);
  }
  return parseMcpServersEnv(process.env.XRK_MCP_SERVERS);
}

/** Env/config win; empty → Face dump `~/.xrk/host-settings.json`. */
function resolveMcpSpecs(config: HostConfig) {
  const configured = configuredMcpSpecs(config);
  if (configured.length > 0) return configured;
  return readMcpServersFromHostSettings(hostSettingsPath());
}

/**
 * Connect allow: env `XRK_MCP_ALLOW` (CI/headless) wins, else Face
 * `mcp.allowConnect` in host-settings.json (Web Settings).
 */
function resolveMcpAllowConnect(
  config: HostConfig,
  faceAllow?: boolean,
): boolean {
  if (config.runtime.mcpAllowConnect) return true;
  if (faceAllow === true) return true;
  if (faceAllow === false) return false;
  return readMcpAllowFromHostSettings(hostSettingsPath());
}

/**
 * `prepareArgv` for the Host-wide shared shell. Resolves the sandbox stack
 * lazily at spawn time so Face settings (arriving after shell creation) and
 * per-session `sandboxMode` are honored — `danger-full-access` unlocks, every
 * other mode confines. This is the production confine path: the harness
 * preset's own `sharedShell ?? createLocalShell(prepareArgv)` branch would
 * otherwise run bash completely unsandboxed.
 */
export function createHostShellPrepareArgv(options: {
  readonly workspaceRoot: string;
  readonly readSandboxSettings: () => Record<string, unknown> | undefined;
  readonly readSandboxMode: (sessionId: string | undefined) => import("@xrkseek/protocol").SandboxMode;
  readonly remoteExecution: boolean;
  readonly env: NodeJS.ProcessEnv;
}): NonNullable<
  Parameters<typeof createLocalShell>[0]["prepareArgv"]
> {
  let cachedStack: SandboxService | undefined;
  let cachedProductKey = "";
  return async (argv, cwd, signal, ctx) => {
    const settings = options.readSandboxSettings();
    const product = parseSandboxProduct(settings);
    const productKey = JSON.stringify(product ?? null);
    if (!cachedStack || cachedProductKey !== productKey) {
      cachedStack = createSandboxStack({
        workspaceRoot: options.workspaceRoot,
        ...(product ? { product } : {}),
        env: options.env,
        ...(options.remoteExecution ? { remoteExecution: true } : {}),
      });
      cachedProductKey = productKey;
    }
    // Per-session unlock: `danger-full-access` runs bash untouched.
    const mode = options.readSandboxMode(ctx?.ownerSessionId);
    if (!shouldConfineSandbox(mode)) return argv;
    const confined = await cachedStack.confine(argv, cwd, signal);
    return confined;
  };
}

export type AgentImageResolver = (
  attachmentId: string,
) => Promise<{
  readonly mediaType: string;
  readonly data: Uint8Array;
  readonly ref?: import("@xrkseek/protocol").ImageAttachmentRef;
}>;

export type AgentFactory = (input: {
  sessionId: string;
  store: SessionStore;
  workspaceRoot: string;
  /** Sidebar workspace title for durable inject anchor (display-only). */
  workspaceDisplayTitle?: string;
  /**
   * Session Face `agentPreset` (header badge). Host factory must honor this for
   * tool composition — it is not cosmetic. Falls back to Host `--preset`.
   */
  agentPreset?: string;
  /** Plugins loaded by host (`XRK_PLUGINS_DIR` / register). Wire via `wireCompositionTools`. */
  plugins: readonly RegisteredPlugin[];
  /** Attachment bytes for vision user content (Host local store). */
  resolveImage?: AgentImageResolver;
  /**
   * Resolve uploaded file attachment refs to host paths for model `read_file`
   * (AttachmentStore.fileHostPath).
   */
  resolveFilePath?: (
    ref: import("@xrkseek/protocol").FileAttachmentRef,
  ) => string | undefined;
  /** Shared attachment store for tools + vision. */
  attachments?: import("@xrkseek/attachment").AttachmentStore;
  /**
   * Extra absolute roots the model may `read_file`.
   * Whitelist only: attachment alias tree and `{XRK_HOME}/spill` — not all of
   * product home. Symlink escape out of a listed root is denied.
   */
  hostReadableRoots?: readonly string[];
  /** Live route image gate for `read_image`. */
  routeAllowsImage?: () => boolean;
  /**
   * Host-shared PTY registry (harness/server). Survives agent invalidate so
   * sandbox-mode fence and open sessions stay composition-true.
   */
  ptyService?: import("@xrkseek/exec-pty").TerminalSessionService;
  /**
   * Host-shared jobs registry (harness/server). Composition scopes by sessionId;
   * Host stop disposes. Survives agent invalidate like PTY.
   */
  shellJobs?: import("@xrkseek/exec-shell").ShellService;
  /**
   * Host-shared browser runtime registry. Survives agent invalidate so open
   * pages / CDP callers stay across Settings rebuilds; Host stop or session
   * finalize drops them.
   */
  browserRuntime?: import("@xrkseek/exec-web").BrowserRuntimeRegistry;
  /**
   * Host cron scheduler — registers `cronjob` tool for unattended turns / scripts.
   * Omitted inside nested cron agent runs to prevent recursive scheduling.
   */
  cronScheduler?: import("@xrkseek/server-cron").CronScheduler;
  /**
   * Optional FsService override (SSH remote workspace). When set with
   * `remoteExecution`, tools use remote path coordinates.
   */
  fs?: import("@xrkseek/exec-fs").FsService;
  /** Pair with `fs` for SSH — skip local path.resolve sandbox. */
  remoteExecution?: boolean;
  /** Optional `run_code` backend (SSH Node when remote). */
  codeRuntime?: import("@xrkseek/code-runtime").CodeRuntime;
  /**
   * Face-backed LLM when settings + credentials are configured.
   * Host wires this after Face runtime starts; falls back to env/replay in presets.
   */
  resolveLlm?: (sessionId: string) => LlmAdapter | undefined;
  /** Face Plugins → agent-loop / bash / web-search (Host reads live Face namespaces). */
  maxParallelToolCalls?: number;
  /** Face `agent-loop.maxSteps` — LLM steps per user turn. */
  maxSteps?: number;
  /** Face `agent-loop.toolOrder` — DSH-style tool wire order. */
  toolOrder?: readonly string[];
  /** Face `agent-loop.toolSettle`. */
  toolSettle?: "serial" | "parallel";
  /** Face `agent-loop.llmRetryMaxRetries` (`0` disables). */
  llmRetryMaxRetries?: number;
  bashLimits?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    foregroundYieldMs?: number;
  };
  /** Face `agent-loop` soft compaction budget (harness). */
  compaction?: {
    maxRequestTokens?: number;
    keepTokens?: number;
    bufferTokens?: number;
    strategy?:
      | "prune-summary"
      | "prune-only"
      | "summary-only"
      | "off";
  };
  /** Face `agent-loop.toolResultMaxInlineBytes` — spill ceiling (`0` disables). */
  toolResultMaxInlineBytes?: number;
  /** Face `agent-loop.guardianFragments` — thin Guardian turn-start nudge. */
  guardianFragments?: boolean;
  /** Merged Face web-search + vault keys for `createDefaultWebAccess({ search })`. */
  webSearch?: import("@xrkseek/exec-web").SearchAccessConfig;
  /** Face `workspace-inject.injectMaxChars` — rules/skills inject budget. */
  workspaceInject?: { readonly maxChars?: number };
  /**
   * Face `session-telemetry` product (Settings SoT).
   * `XRK_TELEMETRY` env still bypasses for CI.
   */
  sessionTelemetry?: import("@xrkseek/session-telemetry").SessionTelemetryProductConfig;
  /**
   * Face `sandbox` product (Settings SoT).
   * `XRK_SANDBOX_BACKEND` env still bypasses for CI.
   */
  sandbox?: import("@xrkseek/exec-sandbox").SandboxProductConfig;
  /**
   * Face `computer-use` product (Settings SoT).
   * `XRK_COMPUTER_USE` env still bypasses for CI.
   */
  computerUseProduct?: import("@xrkseek/exec-computer-use").ComputerUseProductConfig;
  /**
   * Env overlay for computer-use (Credentials `XRK_COMPUTER_USE_BACKGROUND`).
   */
  computerUseEnv?: NodeJS.ProcessEnv;
  /**
   * Face `browser` product (Settings SoT).
   * `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL` env still bypasses for CI.
   */
  browserProduct?: import("@xrkseek/exec-web").BrowserProductConfig;
  /**
   * Face `voice` product (Settings SoT).
   * `XRK_VOICE` env still bypasses for CI.
   */
  voiceProduct?: import("@xrkseek/exec-voice").VoiceProductConfig;
  /** Env overlay for voice (Credentials `XRK_VOICE_OPENAI_KEY`). */
  voiceEnv?: NodeJS.ProcessEnv;
  /**
   * Face `image-gen` product (Settings SoT).
   * `XRK_IMAGE_GEN` env still bypasses for CI.
   */
  imageGenProduct?: import("@xrkseek/exec-image-gen").ImageGenProductConfig;
  /** Env overlay for image-gen (Credentials `XRK_IMAGE_GEN_OPENAI_KEY`). */
  imageGenEnv?: NodeJS.ProcessEnv;
  /**
   * Face `video-gen` product (Settings SoT).
   * `XRK_VIDEO_GEN` env still bypasses for CI.
   */
  videoGenProduct?: import("@xrkseek/exec-video-gen").VideoGenProductConfig;
  /** Env overlay for video-gen (Credentials `XRK_VIDEO_GEN_OPENAI_KEY`). */
  videoGenEnv?: NodeJS.ProcessEnv;
  /**
   * Face `video-analyze` product (Settings SoT).
   * `XRK_VIDEO_ANALYZE` env still bypasses for CI.
   */
  videoAnalyzeProduct?: import("@xrkseek/exec-video-analyze").VideoAnalyzeProductConfig;
  /** Env overlay for video-analyze (Credentials `XRK_VIDEO_ANALYZE_OPENAI_KEY`). */
  videoAnalyzeEnv?: NodeJS.ProcessEnv;
  /**
   * Face `curated-memory` product: pass `false` to skip MEMORY.md / USER.md;
   * pass a provider to share Host Phase1 consolidation store with Agent tools.
   * `XRK_CURATED_MEMORY=0` env still force-disables for CI.
   */
  curatedMemory?: false | MemoryProvider;
  /**
   * Face `locale` product (Settings SoT) — drives the harness `language` prompt
   * section so reasoning follows the UI language.
   */
  locale?: "zh" | "en";
}) => Promise<AgentHandle>;

export type { SessionDrainControl } from "./drain-status.js";

export interface HostInstance {
  readonly id: string;
  readonly config: HostConfig;
  readonly store: SessionStore;
  readonly loader: PluginLoader;
  /** Plugin ids loaded via `runtime.pluginsDir` on spawn (may be empty). */
  readonly loadedPluginIds: readonly string[];
  readonly http: HarnessHttpServer;
  readonly drain: SessionDrainControl;
  readonly status: "starting" | "running" | "stopped";
  health(): {
    ok: boolean;
    status: string;
    port?: number;
    plugins?: readonly string[];
    /** Resolved MCP connect allow (Face Settings and/or env override). */
    mcpAllowConnect?: boolean;
  };
  stop(): Promise<void>;
}

export interface HostManager {
  spawn(
    config: HostConfig,
    factory: AgentFactory,
    options?: HostSpawnOptions,
  ): Promise<HostInstance>;
  get(id: string): HostInstance | undefined;
  list(): readonly HostInstance[];
  stop(id: string): Promise<void>;
  stopAll(): Promise<void>;
}

export function createHostManager(): HostManager {
  const instances = new Map<string, HostInstance>();
  let seq = 0;

  return {
    async spawn(config, factory, options) {
      const log = options?.logger;
      if (installOutboundHttpProxy()) {
        log?.info("outbound HTTP proxy installed (HTTP(S)_PROXY / ALL_PROXY / NO_PROXY)");
      }
      const id = `host_${++seq}`;
      const sessionsDir = config.runtime.sessionsDir?.trim();
      let store: SessionStore;
      try {
        store = sessionsDir
          ? createPersistentSessionStore(sessionsDir)
          : createMemorySessionStore();
      } catch (err) {
        if (err instanceof SessionsDirInUseError) {
          log?.error(err.message);
          throw err;
        }
        throw err;
      }
      let invariantsRegistry: ReturnType<typeof mountInvariantsFailFast>["registry"] | undefined;
      if (config.runtime.invariantsFailFast) {
        const mounted = mountInvariantsFailFast(store);
        store = mounted.store;
        invariantsRegistry = mounted.registry;
        log?.info(
          "runtime invariants fail-fast enabled (XRK_INVARIANTS_FAIL_FAST)",
        );
      }
      const loader = createPluginLoader();
      const registry = createProviderRegistry();
      // Face / mutate / soft-disable always share this absolute path. Config may
      // omit pluginsDir until ~/.xrk/plugins exists; still reconcile when the
      // directory is present so Settings install/disable works in-process.
      const configuredPluginsDir = config.runtime.pluginsDir?.trim();
      const resolvedPluginsDir = configuredPluginsDir
        ? path.resolve(configuredPluginsDir)
        : path.join(resolveXrkHome(), "plugins");
      const managedPluginsRootReady = () => existsSync(resolvedPluginsDir);

      let loadedPluginIds: string[] = [];
      if (managedPluginsRootReady()) {
        // Single path with Settings soft-disable: discover+load enabled,
        // skip soft-disabled (never mcp:*). Optional load failures warn;
        // required failures throw (abort spawn).
        const bootPlugins = await reconcileManagedProcessPlugins(
          loader,
          resolvedPluginsDir,
        );
        loadedPluginIds = [...bootPlugins.ids];
        for (const failure of bootPlugins.failures) {
          log?.warn(
            `plugin load failed (${failure.id}): ${failure.message}`,
          );
        }
      }

      // File rules first, then kind:policy plugins. Delegate so a later
      // plugin refresh / policy-file watch rebuilds without swapping captures.
      let filePolicy = config.runtime.policyFile
        ? await loadPolicyRulesetFile(config.runtime.policyFile)
        : undefined;
      let policyEngine = composeHostPolicyEngine({
        ...(filePolicy !== undefined ? { file: filePolicy } : {}),
        plugins: loader.list(),
      });
      const policy = {
        evaluate: (subject: Parameters<typeof policyEngine.evaluate>[0]) =>
          policyEngine.evaluate(subject),
      };
      const rebuildPolicyEngine = (): void => {
        policyEngine = composeHostPolicyEngine({
          ...(filePolicy !== undefined ? { file: filePolicy } : {}),
          plugins: loader.list(),
        });
      };
      const policyFileWatch = config.runtime.policyFile
        ? watchPolicyFile({
            filePath: config.runtime.policyFile,
            onReload: (next) => {
              filePolicy = next;
              rebuildPolicyEngine();
              log?.info(`policy reloaded (${config.runtime.policyFile})`);
            },
            onError: (err) => {
              const msg = err instanceof Error ? err.message : String(err);
              log?.warn(`policy reload skipped: ${msg}`);
            },
          })
        : undefined;

      const hostPublic = {
        host: config.runtime.host,
        port: config.runtime.port,
        workspaceRoot: config.runtime.workspaceRoot,
        preset: config.runtime.preset,
        corsOrigin: String(config.runtime.corsOrigin),
        rateLimitPerMinute: config.runtime.rateLimitPerMinute,
        // Always absolute so Face inventory / soft-disable match mutate + overlay.
        pluginsDir: resolvedPluginsDir,
        webDistConfigured: Boolean(config.runtime.webDist),
        cordisHostApplied: [] as string[],
        cordisHostPackages: [] as Array<{
          packageName: string;
          rpcChannels: string[];
        }>,
        processChannels: [] as Array<{
          pluginId: string;
          channelId: string;
          displayName?: string;
        }>,
      };

      const mcpSpecs = resolveMcpSpecs(config);
      const mcpFileSourced = configuredMcpSpecs(config).length === 0;
      let mcpAllowConnect = resolveMcpAllowConnect(config);
      if (mcpSpecs.length > 0) {
        log?.info(
          `mcp desired ${mcpSpecs.length} (source=${mcpFileSourced ? "host-settings" : "env/config"}; allow=${mcpAllowConnect ? "on" : "off"})`,
        );
      }
      let invalidateAgents: () => Promise<void> = async () => {};
      /** Sessions skipped mid-turn; invalidate once drain goes idle. */
      const pendingAgentInvalidate = new Set<string>();
      const drainActiveBox: {
        isActive: (sessionId: string) => boolean;
        activeIds: () => readonly string[];
      } = {
        isActive: () => false,
        activeIds: () => [],
      };
      /** Soft-detach MCP while drains hold mid-turn tool handles. */
      const mcpDeferred = createMcpDeferredDispose({
        detach: (id) => loader.detach(id),
        unregister: (id) => loader.unregister(id),
        isBusy: () =>
          drainActiveBox.activeIds().length > 0 ||
          pendingAgentInvalidate.size > 0,
      });
      const mcpUnregister = async (pluginId: string) => {
        await mcpDeferred.remove(pluginId);
        loadedPluginIds = loadedPluginIds.filter((x) => x !== pluginId);
      };
      /** Mutable Face inventory — Host splices after MCP reconcile / health. */
      const facePlugins: RegisteredPlugin[] = [];
      const refreshFacePlugins = () => {
        facePlugins.splice(0, facePlugins.length, ...loader.list());
        wireCompositionLlm(registry, { plugins: loader.list() });
        wireCompositionChannels({ plugins: loader.list() });
        rebuildPolicyEngine();
        hostPublic.processChannels = collectChannelPluginRegistrations(
          loader.list(),
        ).map((row) => ({
          pluginId: row.pluginId,
          channelId: row.channelId,
          ...(row.displayName !== undefined
            ? { displayName: row.displayName }
            : {}),
        }));
      };
      let notifyMcpOverlay: () => void = () => {
        refreshFacePlugins();
      };
      const attachments = createLocalAttachmentStore({
        xrkHome: resolveXrkHome(),
      });
      const attachmentsRoot = resolveLocalAttachmentsRoot(resolveXrkHome());
      /** Filled after Face boot — MCP image gate reads live Registry modalities. */
      const faceForModality: { current?: FaceRuntime } = {};
      const mcpImageAdmission = {
        attachments,
        allowsImageInput: () =>
          faceForModality.current
            ? liveRouteAllowsImageInput(faceForModality.current)
            : false,
      };
      const mcpHooks = {
        onToolsChanged: () => invalidateAgents(),
        onHealthChanged: () => {
          notifyMcpOverlay();
        },
      };
      if (mcpSpecs.length > 0) {
        const boot = await reconcileMcpToolPlugins({
          desired: mcpSpecs,
          list: () => loader.list(),
          register: (plugin) => {
            loader.register(plugin);
            if (!loadedPluginIds.includes(plugin.id)) {
              loadedPluginIds = [...loadedPluginIds, plugin.id];
            }
          },
          unregister: mcpUnregister,
          retained: () => mcpDeferred.retained(),
          policy,
          allowConnect: mcpAllowConnect,
          workspaceRoot: config.runtime.workspaceRoot,
          imageAdmission: mcpImageAdmission,
          ...mcpHooks,
        });
        logMcpReconcile(log, "boot", boot);
      }
      refreshFacePlugins();

      const agentCache = createHostAgentCache(loader.list(), { hostId: id });
      // MCP remount / settings_mutate runs inside an active drain. Aborting that
      // agent mid-tool yields "Error: tool call aborted". Skip active sessions
      // and invalidate them after the turn settles. Soft-detach (not dispose)
      // MCP clients until those drains go idle — see mcpDeferred.
      invalidateAgents = async () => {
        await agentCache.invalidateAll({
          skip: (sessionId) => {
            if (!drainActiveBox.isActive(sessionId)) return false;
            pendingAgentInvalidate.add(sessionId);
            return true;
          },
        });
        await mcpDeferred.flush();
      };
      let mcpSyncTail: Promise<unknown> = Promise.resolve();
      const lastDrainResult = new Map<string, AgentRunResult>();

      // Local Host + remote cwd: swap fs/shell (Hermes/DSH provider pattern).
      // Env `XRK_SSH_HOST` CI-bypasses Face; else peek settings.yaml before Face
      // (SSH world must own workspaceRoot before createFaceRuntime).
      // Optional HTTP ExecEnvironment (Modal/e2b-style sidecar) when SSH is off.
      let sshWorld: SshExecutionWorld | undefined;
      let httpWorld: ExecWorld | undefined;
      /** Local Host cwd before SSH workspace swap (browse/settings anchor). */
      let localHostRoot: string | undefined;
      let execWorldKind: "ssh" | "http" | undefined;
      try {
        const sshProduct = peekSettingsYamlSection(resolveXrkHome(), "ssh-remote");
        const sshConfig = resolveSshConfig(process.env, sshProduct);
        if (sshConfig) {
          execWorldKind = "ssh";
          localHostRoot = config.runtime.workspaceRoot;
          sshWorld = await createSshExecutionWorldReady({ config: sshConfig });
          // Tool coordinates are the remote workspace; Face session cwd follows.
          (config.runtime as { workspaceRoot: string }).workspaceRoot =
            sshWorld.workspaceRoot;
        } else if (
          String(process.env.XRK_EXEC_ENVIRONMENT ?? "")
            .trim()
            .toLowerCase() === "http"
        ) {
          execWorldKind = "http";
          const provider = resolveExecEnvironment({ env: process.env });
          httpWorld = await provider.createWorld({
            workspaceRoot: config.runtime.workspaceRoot,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          execWorldKind === "http"
            ? `HTTP exec environment: ${message}`
            : `SSH remote workspace: ${message}`,
          { cause: err },
        );
      }

      // Codex-shaped outbound allowlist audit → Host logger (not MITM).
      setOutboundAllowlistAuditObserver((ev) => {
        log?.debug(
          `web-fetch-allowlist ${ev.decision} ${ev.host} (${ev.source}: ${ev.reason})`,
        );
      });

      const sharedPty =
        !sshWorld &&
        (config.runtime.preset === "harness" ||
          config.runtime.preset === "server")
          ? createDefaultPtyAccess({
              workspaceRoot: config.runtime.workspaceRoot,
            })
          : undefined;

      const sharedShell =
        config.runtime.preset === "harness" || config.runtime.preset === "server"
          ? createLocalShell({
              subprocess: sshWorld
                ? sshWorld.subprocess
                : httpWorld
                  ? httpWorld.subprocess
                  : createLocalSubprocess(),
              defaultCwd: config.runtime.workspaceRoot,
              // Host-wide shared registry — sandbox confine resolves lazily so
              // Face settings + per-session sandboxMode are read at spawn time,
              // not at shell creation (faceBox.runtime arrives later). This is
              // the production path the harness preset's `sharedShell ??`
              // branch would otherwise bypass entirely.
              prepareArgv: createHostShellPrepareArgv({
                workspaceRoot: config.runtime.workspaceRoot,
                readSandboxSettings: () => {
                  const rt = faceBox.runtime;
                  if (!rt) return undefined;
                  return rt.settingsNamespaces.view("sandbox").value as Record<
                    string,
                    unknown
                  >;
                },
                readSandboxMode: (sessionId) =>
                  effectiveSandboxMode(
                    sessionId
                      ? readSessionEvents(store, sessionId)
                      : [],
                  ),
                remoteExecution: sshWorld !== undefined,
                env: process.env,
              }),
            })
          : undefined;

      /** Session-keyed browser pages — survives agent invalidate (Hermes task_id map). */
      const sharedBrowser =
        config.runtime.preset === "harness" || config.runtime.preset === "server"
          ? createBrowserRuntimeRegistry()
          : undefined;

      const ensureSession = (sid?: string) => newSession(store, sid).id;

      const faceBox: {
        approvals?: FaceApprovalBroker;
        questions?: FaceQuestionBroker;
        runtime?: FaceRuntime;
      } = {};

      /** Session-end Phase1 (+ optional Phase2 LLM): fold leftover notes into MEMORY.md. */
      let curatedMemProvider: MemoryProvider | undefined;
      const getCuratedMemProvider = (): MemoryProvider => {
        if (!curatedMemProvider) {
          curatedMemProvider = resolveMemoryProvider();
        }
        return curatedMemProvider;
      };
      const consolidateCuratedMemoryForSession = (sessionId: string): void => {
        try {
          const rt = faceBox.runtime;
          const memEnvRaw = String(process.env.XRK_CURATED_MEMORY ?? "").trim();
          let enabled = memEnvRaw !== "" ? memEnvRaw !== "0" : true;
          let phase2Llm = false;
          if (memEnvRaw === "" && rt) {
            const memNs = rt.settingsNamespaces.view("curated-memory")
              .value as Record<string, unknown>;
            enabled = memNs.enabled !== false;
            phase2Llm = memNs.phase2Llm === true;
          }
          const phase2Env = String(
            process.env.XRK_CURATED_MEMORY_PHASE2 ?? "",
          ).trim();
          if (phase2Env === "1" || phase2Env.toLowerCase() === "true") {
            phase2Llm = true;
          }
          if (!enabled) return;
          const userTexts: string[] = [];
          const assistantTexts: string[] = [];
          for (const event of readSessionEvents(store, sessionId)) {
            if (event.type === "user/message") {
              if (!isHumanUserMessageSource(event.source)) continue;
              const text = flattenText(event.content).trim();
              if (text) userTexts.push(text);
              continue;
            }
            if (event.type === "assistant/message") {
              const text = flattenText(event.content ?? "").trim();
              if (text) assistantTexts.push(text);
            }
          }
          if (userTexts.length === 0) return;
          const memStore = getCuratedMemProvider();
          void (async () => {
            await consolidateCuratedMemoryPhase1(memStore, { userTexts });
            if (!phase2Llm) return;
            const llm = llmResolverBox.resolve?.(sessionId);
            if (!llm?.chat) return;
            await consolidateCuratedMemoryPhase2(memStore, {
              userTexts,
              assistantTexts,
              complete: async (prompt) => {
                const out = await llm.chat({
                  messages: [{ role: "user", content: prompt }],
                });
                return String(out.content ?? "");
              },
            });
          })();
        } catch {
          /* best-effort — Host stop / archive must continue */
        }
      };
      const runWorkspaceSkillCurator = (): void => {
        try {
          void runSkillCurator({
            workspaceRoot: config.runtime.workspaceRoot,
          });
        } catch {
          /* best-effort — Host stop must continue */
        }
      };
      const llmResolverBox: {
        resolve?: (sessionId: string) => LlmAdapter | undefined;
      } = {};
      const pluginSettingsBox: {
        read?: () => {
          maxParallelToolCalls?: number;
          maxSteps?: number;
          autoContinueOnMaxTokens?: boolean;
          autoContinueMaxRounds?: number;
          toolOrder?: readonly string[];
          toolSettle?: "serial" | "parallel";
          llmRetryMaxRetries?: number;
          bashLimits?: {
            timeoutMs?: number;
            maxOutputBytes?: number;
            foregroundYieldMs?: number;
          };
          compaction?: {
            maxRequestTokens?: number;
            keepTokens?: number;
            bufferTokens?: number;
            strategy?:
              | "prune-summary"
              | "prune-only"
              | "summary-only"
              | "off";
          };
          toolResultMaxInlineBytes?: number;
          guardianFragments?: boolean;
          maxSubagentDepth?: number;
          maxActiveSubagents?: number;
          webSearch?: import("@xrkseek/exec-web").SearchAccessConfig;
          workspaceInject?: { readonly maxChars?: number };
          sessionTelemetry?: import("@xrkseek/session-telemetry").SessionTelemetryProductConfig;
          sandbox?: import("@xrkseek/exec-sandbox").SandboxProductConfig;
          computerUseProduct?: import("@xrkseek/exec-computer-use").ComputerUseProductConfig;
          computerUseEnv?: NodeJS.ProcessEnv;
          browserProduct?: import("@xrkseek/exec-web").BrowserProductConfig;
          voiceProduct?: import("@xrkseek/exec-voice").VoiceProductConfig;
          voiceEnv?: NodeJS.ProcessEnv;
          imageGenProduct?: import("@xrkseek/exec-image-gen").ImageGenProductConfig;
          imageGenEnv?: NodeJS.ProcessEnv;
          videoGenProduct?: import("@xrkseek/exec-video-gen").VideoGenProductConfig;
          videoGenEnv?: NodeJS.ProcessEnv;
          videoAnalyzeProduct?: import("@xrkseek/exec-video-analyze").VideoAnalyzeProductConfig;
          videoAnalyzeEnv?: NodeJS.ProcessEnv;
          curatedMemory?: false | MemoryProvider;
          /** Face `locale.preference` — reasoning/reply language directive. */
          locale?: "zh" | "en";
        };
      } = {};
      const sessionCwdBox: {
        get?: (sessionId: string) => string | undefined;
      } = {};
      const sessionPresetBox: {
        get?: (sessionId: string) => string | undefined;
      } = {};
      const hostStatusBox: {
        publish?: (sessionId: string, running: boolean) => void;
      } = {};

      const lineage: { parentOf: (sessionId: string) => string | undefined } = {
        parentOf: () => undefined,
      };

      // Sidebar agent-opens / agent-terminals — Host registries (not plugin host.mjs).
      const agentOpenRegistry = new AgentOpenRegistry();
      const agentPtyRegistry = new AgentPtyRegistry();
      const cronBox: { scheduler?: CronScheduler | undefined } = {};

      const resolveAgent = async (sessionId: string) => {
        // Cache composition binding only — never treat AgentHandle as transcript source (ADR-0003).
        const parentSessionId = lineage.parentOf(sessionId);
        const sessionRoot =
          sessionCwdBox.get?.(sessionId) ?? config.runtime.workspaceRoot;
        const agentPreset = sessionPresetBox.get?.(sessionId);
        const wsId = faceRuntime.workspaces.workspaceIdOf(sessionId);
        const wsRow = wsId ? faceRuntime.workspaces.get(wsId) : undefined;
        return agentCache.resolve(
          sessionId,
          async () => {
            const pluginSettings = pluginSettingsBox.read?.() ?? {};
            const agent = await factory({
              sessionId,
              store,
              workspaceRoot: sessionRoot,
              ...(wsRow?.title ? { workspaceDisplayTitle: wsRow.title } : {}),
              plugins: loader.list(),
              attachments,
              // Spill subtree + attachments only — never resolveXrkHome().
              hostReadableRoots: [
                attachmentsRoot,
                defaultSpillDir(),
              ],
              routeAllowsImage: () =>
                faceForModality.current
                  ? liveRouteAllowsImageInput(faceForModality.current, sessionId)
                  : false,
              ...(agentPreset ? { agentPreset } : {}),
              resolveImage: async (attachmentId) => {
                const stored = await attachments.readImage(attachmentId);
                return {
                  mediaType: stored.ref.mediaType,
                  data: stored.data,
                  ref: stored.ref,
                };
              },
              resolveFilePath: (ref) => attachments.fileHostPath?.(ref),
              ...(sharedPty ? { ptyService: sharedPty.service } : {}),
              ...(sharedShell ? { shellJobs: sharedShell } : {}),
              ...(sharedBrowser ? { browserRuntime: sharedBrowser } : {}),
              ...(cronBox.scheduler && !cronAgentDepth.getStore()
                ? { cronScheduler: cronBox.scheduler }
                : {}),
              ...(sshWorld
                ? {
                    fs: sshWorld.fs,
                    remoteExecution: true as const,
                    codeRuntime: sshWorld.codeRuntime,
                  }
                : httpWorld
                  ? { fs: httpWorld.fs }
                  : {}),
              ...(faceBox.runtime
                ? {
                    browserVault: {
                      list() {
                        return listCredentialSlots(faceBox.runtime!)
                          .filter((s) => s.configured)
                          .map((s) => ({
                            handle: s.id,
                            label: s.label,
                            kind: "credential",
                          }));
                      },
                      peek(handle: string) {
                        return faceBox.runtime?.credentials.peek(handle);
                      },
                    },
                  }
                : {}),
              ...(llmResolverBox.resolve
                ? { resolveLlm: llmResolverBox.resolve }
                : {}),
              ...(pluginSettings.maxParallelToolCalls !== undefined
                ? { maxParallelToolCalls: pluginSettings.maxParallelToolCalls }
                : {}),
              ...(pluginSettings.maxSteps !== undefined
                ? { maxSteps: pluginSettings.maxSteps }
                : {}),
              ...(pluginSettings.autoContinueOnMaxTokens !== undefined
                ? {
                    autoContinueOnMaxTokens:
                      pluginSettings.autoContinueOnMaxTokens,
                  }
                : {}),
              ...(pluginSettings.autoContinueMaxRounds !== undefined
                ? {
                    autoContinueMaxRounds: pluginSettings.autoContinueMaxRounds,
                  }
                : {}),
              ...(pluginSettings.toolOrder !== undefined
                ? { toolOrder: pluginSettings.toolOrder }
                : {}),
              ...(pluginSettings.toolSettle !== undefined
                ? { toolSettle: pluginSettings.toolSettle }
                : {}),
              ...(pluginSettings.llmRetryMaxRetries !== undefined
                ? { llmRetryMaxRetries: pluginSettings.llmRetryMaxRetries }
                : {}),
              ...(pluginSettings.bashLimits
                ? { bashLimits: pluginSettings.bashLimits }
                : {}),
              ...(pluginSettings.compaction
                ? { compaction: pluginSettings.compaction }
                : {}),
              ...(pluginSettings.toolResultMaxInlineBytes !== undefined
                ? {
                    toolResultMaxInlineBytes:
                      pluginSettings.toolResultMaxInlineBytes,
                  }
                : {}),
              ...(pluginSettings.guardianFragments !== undefined
                ? { guardianFragments: pluginSettings.guardianFragments }
                : {}),
              ...(pluginSettings.locale
                ? { locale: pluginSettings.locale }
                : {}),
              ...(pluginSettings.webSearch
                ? { webSearch: pluginSettings.webSearch }
                : {}),
              ...(pluginSettings.workspaceInject
                ? { workspaceInject: pluginSettings.workspaceInject }
                : {}),
              ...(pluginSettings.sessionTelemetry
                ? { sessionTelemetry: pluginSettings.sessionTelemetry }
                : {}),
              ...(pluginSettings.sandbox
                ? { sandbox: pluginSettings.sandbox }
                : {}),
              ...(pluginSettings.computerUseProduct
                ? { computerUseProduct: pluginSettings.computerUseProduct }
                : {}),
              ...(pluginSettings.computerUseEnv
                ? { computerUseEnv: pluginSettings.computerUseEnv }
                : {}),
              ...(pluginSettings.browserProduct
                ? { browserProduct: pluginSettings.browserProduct }
                : {}),
              ...(pluginSettings.voiceProduct
                ? { voiceProduct: pluginSettings.voiceProduct }
                : {}),
              ...(pluginSettings.voiceEnv
                ? { voiceEnv: pluginSettings.voiceEnv }
                : {}),
              ...(pluginSettings.imageGenProduct
                ? { imageGenProduct: pluginSettings.imageGenProduct }
                : {}),
              ...(pluginSettings.imageGenEnv
                ? { imageGenEnv: pluginSettings.imageGenEnv }
                : {}),
              ...(pluginSettings.videoGenProduct
                ? { videoGenProduct: pluginSettings.videoGenProduct }
                : {}),
              ...(pluginSettings.videoGenEnv
                ? { videoGenEnv: pluginSettings.videoGenEnv }
                : {}),
              ...(pluginSettings.videoAnalyzeProduct
                ? { videoAnalyzeProduct: pluginSettings.videoAnalyzeProduct }
                : {}),
              ...(pluginSettings.videoAnalyzeEnv
                ? { videoAnalyzeEnv: pluginSettings.videoAnalyzeEnv }
                : {}),
              ...(pluginSettings.curatedMemory === false
                ? { curatedMemory: false as const }
                : { curatedMemory: getCuratedMemProvider() }),
            });
            if (faceBox.approvals) {
              agent.setApprovalHandler(faceBox.approvals.handlerFor(sessionId));
            }
            // ask_user / exit_plan_mode: Face resolveAgent rebinds once.
            if (agent.tools && faceBox.runtime) {
              const profile = resolveAgentPresetProfile(
                agentPreset ?? config.runtime.preset,
                config.runtime.preset,
              );
              if (profile.subagents.mode === "on") {
                const faceDepth =
                  pluginSettings.maxSubagentDepth ?? DEFAULT_MAX_DEPTH;
                const faceActive =
                  pluginSettings.maxActiveSubagents ??
                  DEFAULT_MAX_ACTIVE_CHILDREN;
                const presetDepth = profile.subagents.maxDepth;
                const presetActive = profile.subagents.maxActiveChildren;
                const maxDepth =
                  presetDepth !== undefined
                    ? Math.min(faceDepth, presetDepth)
                    : faceDepth;
                const maxActiveChildren =
                  presetActive !== undefined
                    ? Math.min(faceActive, presetActive)
                    : faceActive;
                bindSubagentTools(agent.tools, {
                  runtime: faceBox.runtime,
                  parentSessionId: sessionId,
                  maxDepth,
                  maxActiveChildren,
                });
              }
              bindSessionQueryTools(agent.tools, {
                runtime: faceBox.runtime,
                parentSessionId: sessionId,
              });
              const prefs = loadSidebarPrefs(resolveXrkHome()).value;
              if (
                prefs.agentOpenTools === true ||
                prefs.agentTerminalTools === true
              ) {
                bindSidebarAgentTools(agent.tools, {
                  sessionId,
                  agentOpens: agentOpenRegistry,
                  agentPty: agentPtyRegistry,
                  resolveCwd: (sid) =>
                    resolveSessionCwd(faceBox.runtime!, sid) ??
                    faceBox.runtime!.workspaceRoot,
                  readPrefs: () => loadSidebarPrefs(resolveXrkHome()).value,
                  readShellOverrides: () => {
                    const p = loadSidebarPrefs(resolveXrkHome()).value;
                    const shell =
                      typeof p.terminalShell === "string" &&
                      p.terminalShell.trim()
                        ? p.terminalShell.trim()
                        : undefined;
                    const shellArgsRaw =
                      typeof p.terminalShellArgs === "string"
                        ? p.terminalShellArgs.trim()
                        : "";
                    const shellArgs =
                      shellArgsRaw.length > 0
                        ? shellArgsRaw.split(/\s+/).filter(Boolean)
                        : undefined;
                    return {
                      ...(shell ? { shell } : {}),
                      ...(shellArgs ? { shellArgs } : {}),
                    };
                  },
                });
              }
            }
            return agent;
          },
          parentSessionId ? { parentSessionId } : undefined,
        );
      };

      const hub: SessionDrainHub = createSessionDrainHub({
        createDrain: (sessionId) => async ({ signal }) => {
          const snapshot = (): Promise<void> => {
            const face = faceBox.runtime;
            // Soft-bounded; overlaps LLM via continueTurn.beforeTools.
            if (!face || signal.aborted) return Promise.resolve();
            return snapshotSessionWorkspace(face, sessionId, {
              budgetMs: SNAPSHOT_DRAIN_BUDGET_MS,
            }).then(() => undefined);
          };
          try {
            const agent = await resolveAgent(sessionId);
            // Delivery queue rule (docs/session-delivery.md §3):
            // one continueTurn ⇒ one promote; runTurn owns tool continuation
            // without promoting further inbox items. Loop until inbox empty.
            while (agent.pendingAdmits().length > 0) {
              if (signal.aborted) {
                throw hostAbortError(signal.reason);
              }
              // Hermes-style: snapshot worktree before tools mutate files.
              // Start immediately and pass as beforeTools so it overlaps the
              // LLM; do not await serially before continueTurn (that pinned
              // Queue/Steer chrome on large monorepos).
              const snapP = snapshot();
              const result = await agent.continueTurn({
                signal,
                beforeTools: () => snapP,
              });
              await snapP;
              lastDrainResult.set(sessionId, result);
            }
          } finally {
            publishDrainIdle(hub, sessionId, (sid, running) => {
              if (
                !running &&
                "flush" in store &&
                typeof (store as { flush?: () => void }).flush === "function"
              ) {
                (store as { flush: () => void }).flush();
              }
              if (!running && pendingAgentInvalidate.has(sid)) {
                pendingAgentInvalidate.delete(sid);
                void agentCache.invalidate(sid).then(() => mcpDeferred.flush());
              } else if (!running) {
                void mcpDeferred.flush();
              }
              hostStatusBox.publish?.(sid, running);
            });
          }
        },
      });

      const drain: SessionDrainControl = wireDrainStatus(
        hub,
        (sessionId, running) => {
          hostStatusBox.publish?.(sessionId, running);
        },
        lastDrainResult,
      );
      drainActiveBox.isActive = (sessionId) => drain.isActive(sessionId);
      drainActiveBox.activeIds = () => hub.activeIds();

      const cronHostOptions = {
        productHome: resolveXrkHome(),
        workspaceRoot: config.runtime.workspaceRoot,
        runAgent: async (
          job: import("@xrkseek/server-cron").CronJob,
          signal?: AbortSignal,
        ) => {
          const run = job.run;
          if (run.kind !== "agent") {
            return {
              ok: false,
              output: "",
              error: "not an agent job",
            };
          }
          return cronAgentDepth.run(true, async () => {
            const session = store.create();
            try {
              const agent = await resolveAgent(session.id);
              const result = await agent.continueTurn({
                text: `[cron ${job.id}${job.name ? ` ${job.name}` : ""}]\n${run.prompt}`,
                ...(signal ? { signal } : {}),
              });
              return {
                ok: true,
                output: result.text,
                sessionId: session.id,
              };
            } finally {
              // Ephemeral cron sessions must not retain AgentHandle in agentCache
              // (each composition is heavy; ticker would OOM over hours).
              lastDrainResult.delete(session.id);
              hub.forget(session.id);
              try {
                await faceBox.runtime?.onSessionFinalize?.(session.id);
              } catch {
                // best-effort memory/browser cleanup
              }
              if (faceBox.runtime?.invalidateAgent) {
                await faceBox.runtime.invalidateAgent(session.id);
              } else {
                await agentCache.invalidate(session.id);
              }
            }
          });
        },
        onError: (err: unknown) => {
          log?.warn(
            `cron: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      };
      /**
       * Face `cron.enabled` SoT when `XRK_CRON` unset; env non-empty is CI bypass.
       * Returns whether the scheduler presence changed (tools need invalidate).
       */
      const applyCronScheduler = (product?: {
        readonly enabled: boolean;
      }): boolean => {
        const next = createHostCron({
          ...cronHostOptions,
          ...(product ? { product } : {}),
        });
        if (!next) {
          if (!cronBox.scheduler) return false;
          cronBox.scheduler.stop();
          cronBox.scheduler = undefined;
          log?.info("cron ticker stopped");
          return true;
        }
        if (cronBox.scheduler) return false;
        cronBox.scheduler = next;
        next.start();
        log?.info("cron ticker started (~/.xrk/cron/jobs.json)");
        return true;
      };
      // Env-only until Face is ready; re-applied below with Settings product.
      applyCronScheduler();

      const webOverlay = await resolveWebPluginOverlay(resolvedPluginsDir);
      const overlayBoot = webOverlay
        ? loadBootManifestFromWebDist(webOverlay)
        : undefined;
      // Defense only: reconcileBoot already omits soft-disabled ids. Still
      // filter here so a stale web/boot.json cannot load a disabled client
      // (including inventory key/name aliases).
      const disabledIds = readDisabledPluginIdsAt(resolvedPluginsDir);
      const packageIndex = readManagedPackageIndexAt(resolvedPluginsDir);
      const filteredOverlay =
        overlayBoot === undefined || disabledIds.size === 0
          ? overlayBoot
          : {
              rev: overlayBoot.rev,
              entries: overlayBoot.entries.filter(
                (e) => !isPluginSoftDisabledAt(e.id, disabledIds, packageIndex),
              ),
            };
      const boot = applyXrkProductBootPolicy(
        ensureXrkPlatformClientBootEntries(
          mergeWebBootManifests(
            resolveWebBootManifest(config.runtime.webDist),
            filteredOverlay,
          ),
          config.runtime.webDist,
        ),
      );
      // Mutable like facePlugins: soft-disable / remove rewrite boot.json, so
      // inventory must re-read overlay or removed clients stay as active ghosts.
      const faceWebPlugins: { id: string }[] = [];
      const refreshFaceWebPlugins = async () => {
        if (!config.runtime.webDist) {
          faceWebPlugins.splice(0, faceWebPlugins.length);
          return;
        }
        const overlayRoot = await resolveWebPluginOverlay(resolvedPluginsDir);
        const nextOverlay = overlayRoot
          ? loadBootManifestFromWebDist(overlayRoot)
          : undefined;
        const disabled = readDisabledPluginIdsAt(resolvedPluginsDir);
        const index = readManagedPackageIndexAt(resolvedPluginsDir);
        const filtered =
          nextOverlay === undefined || disabled.size === 0
            ? nextOverlay
            : {
                rev: nextOverlay.rev,
                entries: nextOverlay.entries.filter(
                  (e) => !isPluginSoftDisabledAt(e.id, disabled, index),
                ),
              };
        const nextBoot = applyXrkProductBootPolicy(
          ensureXrkPlatformClientBootEntries(
            mergeWebBootManifests(
              resolveWebBootManifest(config.runtime.webDist),
              filtered,
            ),
            config.runtime.webDist,
          ),
        );
        faceWebPlugins.splice(
          0,
          faceWebPlugins.length,
          ...nextBoot.entries.map((e) => ({ id: e.id })),
        );
      };
      faceWebPlugins.push(...boot.entries.map((e) => ({ id: e.id })));
      const hostWireRef: { ctx?: DshCompatOptions } = {};
      const syncCordisHostApplied = () => {
        hostPublic.cordisHostApplied = listHostAppliedPackages().map(
          (row) => row.packageName,
        );
        hostPublic.cordisHostPackages = listHostAppliedPackages().map((row) => ({
          packageName: row.packageName,
          rpcChannels: [...row.rpcChannels],
        }));
      };
      const secretStore = await resolveSecretStore(process.env);
      const faceRuntime = createFaceRuntime({
        store,
        resolveAgent,
        workspaceRoot: config.runtime.workspaceRoot,
        ...(sshWorld
          ? {
              remoteExecution: true as const,
              ...(localHostRoot !== undefined ? { localHostRoot } : {}),
              directoryBackend: createSshDirectoryBackend(sshWorld),
            }
          : {}),
        // Face settings / credentials / workspaces.json / host-settings → harness home.
        productDir: resolveXrkHome(),
        ...(secretStore ? { secretStore } : {}),
        tools: createStandingToolRegistry({
          workspaceRoot: config.runtime.workspaceRoot,
          preset: config.runtime.preset,
        }),
        version: "0.0.0",
        defaultAgentPreset: canonicalAgentPresetId(config.runtime.preset),
        registry,
        attachments,
        // Face intake only (InputBar paste). Live adapter modalities come from
        // Registry — official DeepSeek text models stay text-only; vision-exp
        // declares image; MCP/prompt gate on that.
        inputModalities: ["text", "image"],
        ...(sessionsDir
          ? {
              subagentPersistPath: path.join(sessionsDir, "subagents.json"),
              goalPersistPath: path.join(sessionsDir, "goals.json"),
              feedbackSlicesDir: path.join(sessionsDir, "feedback-slices"),
              listProjectionCachePath: path.join(
                sessionsDir,
                "projection-list-cache.json",
              ),
            }
          : {}),
        plugins: facePlugins,
        removeUserPlugin: async (spec) => {
          const result = await runPluginMutate({
            action: "remove",
            spec,
            pluginsDir: resolvedPluginsDir,
          });
          return result.ok
            ? { ok: true as const }
            : { ok: false as const, error: result.error ?? result.stderr };
        },
        updateUserPlugin: async (spec) => {
          const result = await runPluginMutate({
            action: "add",
            spec,
            pluginsDir: resolvedPluginsDir,
          });
          return result.ok
            ? { ok: true as const }
            : { ok: false as const, error: result.error ?? result.stderr };
        },
        syncManagedProcessPlugins: async () => {
          if (!managedPluginsRootReady()) return;
          const synced = await reconcileManagedProcessPlugins(
            loader,
            resolvedPluginsDir,
          );
          loadedPluginIds = [...synced.ids];
          for (const failure of synced.failures) {
            log?.warn(
              `plugin load failed (${failure.id}): ${failure.message}`,
            );
          }
          refreshFacePlugins();
          await refreshFaceWebPlugins();
          await invalidateAgents();
        },
        ...(mcpFileSourced
          ? {
              syncMcpServers: async (
                servers: readonly McpServerDraft[],
                options?: { readonly allowConnect?: boolean },
              ) => {
                const run = mcpSyncTail.then(async () => {
                  mcpAllowConnect = resolveMcpAllowConnect(
                    config,
                    options?.allowConnect,
                  );
                  const result = await reconcileMcpToolPlugins({
                    desired: mcpDraftsToSpecs(servers),
                    list: () => loader.list(),
                    register: (plugin) => {
                      loader.register(plugin);
                      if (!loadedPluginIds.includes(plugin.id)) {
                        loadedPluginIds = [...loadedPluginIds, plugin.id];
                      }
                    },
                    unregister: mcpUnregister,
                    retained: () => mcpDeferred.retained(),
                    policy,
                    allowConnect: mcpAllowConnect,
                    workspaceRoot: config.runtime.workspaceRoot,
                    imageAdmission: mcpImageAdmission,
                    ...mcpHooks,
                  });
                  logMcpReconcile(log, "reconcile", result);
                  refreshFacePlugins();
                  await invalidateAgents();
                  return {
                    failures: result.failures,
                    parked: result.parked,
                  };
                });
                // Keep the chain alive even if one reconcile rejects.
                mcpSyncTail = run.then(
                  () => undefined,
                  () => undefined,
                );
                return run;
              },
            }
          : {}),
        ...(config.runtime.webDist
          ? { webPlugins: faceWebPlugins }
          : {}),
        hostPublic,
        cordisHostBridge: {
          applyHostHalf: async (packageName: string) => {
            const ctx = hostWireRef.ctx;
            if (!ctx) {
              return { ok: false, message: "Host wire not initialized" };
            }
            const ok = await applyHostPackageByName(ctx, packageName);
            if (ok) syncCordisHostApplied();
            return ok
              ? { ok: true }
              : {
                  ok: false,
                  message: "host.mjs apply failed or package missing",
                };
          },
          invokeRpc: async (channel, endpoint, rpcPayload) => {
            const ctx = hostWireRef.ctx;
            if (!ctx) {
              throw new Error("Host wire not initialized");
            }
            return invokeDshCompatRpc(ctx, channel, endpoint, rpcPayload);
          },
          stopHostHalf: async (packageName: string) => {
            await stopHostPackageFiber(packageName);
          },
        },
        bootstrapApiKey: config.credentials.apiKey,
        policy,
        ...(config.runtime.policyFile
          ? { settingsDocumentPath: path.resolve(config.runtime.policyFile) }
          : {}),
        invalidateAgent: (sessionId) => agentCache.invalidate(sessionId),
        onSessionFinalize: (sessionId) => {
          consolidateCuratedMemoryForSession(sessionId);
          sharedBrowser?.drop(sessionId);
        },
        ...createAutoReviewBridgeFromHost(resolveXrkHome()),
        ...(sharedPty
          ? {
              // Agent terminal_* registry only — never sidebar user PTYs.
              hasPtyActivity: () => sharedPty.service.hasActivity(),
            }
          : {}),
        drain: {
          wake: (sessionId) => drain.wake(sessionId),
          cancel: (sessionId, opts) => drain.cancel(sessionId, opts),
          isActive: (sessionId) => drain.isActive(sessionId),
          run: (sessionId) => hub.run(sessionId),
        },
        ...(sharedShell ? { shell: sharedShell } : {}),
      });
      // Authorize DSH client settings namespaces so panels do not fail
      // "Host 未授权设置 RPC" when Cordis Host is absent (empty docs).
      for (const ns of DSH_SETTINGS_NAMESPACES) {
        const slot = faceRuntime.settingsNamespaces.ensure(ns);
        const seed = DSH_SETTINGS_DEFAULTS[ns];
        if (seed && Object.keys(slot.base).length === 0) {
          slot.base = { ...seed };
        }
      }
      faceForModality.current = faceRuntime;
      faceBox.approvals = faceRuntime.approvals;
      faceBox.questions = faceRuntime.questions;
      faceBox.runtime = faceRuntime;
      // Face hydrate may migrate legacy settings.yaml mcp → host-settings after
      // boot reconcile already ran with []. Remount once when file-sourced.
      if (mcpFileSourced && mcpSpecs.length === 0) {
        const mcpUser = faceRuntime.settingsNamespaces.ensure("mcp").user;
        const drafts = Array.isArray(mcpUser.servers)
          ? (mcpUser.servers as McpServerDraft[])
          : [];
        const desired = mcpDraftsToSpecs(drafts);
        if (desired.length > 0) {
          mcpAllowConnect = resolveMcpAllowConnect(
            config,
            mcpUser.allowConnect === true,
          );
          const migrated = await reconcileMcpToolPlugins({
            desired,
            list: () => loader.list(),
            register: (plugin) => {
              loader.register(plugin);
              if (!loadedPluginIds.includes(plugin.id)) {
                loadedPluginIds = [...loadedPluginIds, plugin.id];
              }
            },
            unregister: mcpUnregister,
            retained: () => mcpDeferred.retained(),
            policy,
            allowConnect: mcpAllowConnect,
            workspaceRoot: config.runtime.workspaceRoot,
            imageAdmission: mcpImageAdmission,
            ...mcpHooks,
          });
          logMcpReconcile(log, "yaml-migrate", migrated);
          refreshFacePlugins();
          await invalidateAgents();
        }
      }
      sessionCwdBox.get = (sessionId) =>
        resolveSessionCwd(faceRuntime, sessionId);
      sessionPresetBox.get = (sessionId) =>
        faceRuntime.sessionAgentPresets.get(sessionId);
      hostStatusBox.publish = (sessionId, running) => {
        faceRuntime.bus.publishHost({
          type: "host/session-status",
          sessionId,
          running,
        });
        faceRuntime.onSessionDrainStatus(sessionId, running);
      };
      llmResolverBox.resolve = (sessionId) =>
        createSessionRoutingLlm(faceRuntime, sessionId);
      pluginSettingsBox.read = () => {
        const loop = faceRuntime.settingsNamespaces.view("agent-loop").value as Record<
          string,
          unknown
        >;
        const bash = faceRuntime.settingsNamespaces.view("bash").value as Record<
          string,
          unknown
        >;
        const webSearchNs = faceRuntime.settingsNamespaces.view("web-search")
          .value as Record<string, unknown>;
        const injectNs = faceRuntime.settingsNamespaces.view("workspace-inject")
          .value as Record<string, unknown>;
        const telemetryNs = faceRuntime.settingsNamespaces.view("session-telemetry")
          .value as Record<string, unknown>;
        const maxParallelToolCalls =
          typeof loop.maxParallelToolCalls === "number" &&
          Number.isFinite(loop.maxParallelToolCalls) &&
          loop.maxParallelToolCalls > 0
            ? Math.floor(loop.maxParallelToolCalls)
            : undefined;
        const maxSteps =
          typeof loop.maxSteps === "number" &&
          Number.isFinite(loop.maxSteps) &&
          loop.maxSteps > 0
            ? Math.floor(loop.maxSteps)
            : undefined;
        const autoContinueOnMaxTokens = loop.autoContinueOnMaxTokens === true;
        const autoContinueMaxRoundsRaw = loop.autoContinueMaxRounds;
        const autoContinueMaxRounds =
          typeof autoContinueMaxRoundsRaw === "number" &&
          Number.isFinite(autoContinueMaxRoundsRaw) &&
          autoContinueMaxRoundsRaw >= 1 &&
          autoContinueMaxRoundsRaw <= 10
            ? Math.floor(autoContinueMaxRoundsRaw)
            : undefined;
        const toolOrderRaw = loop.toolOrder;
        const toolOrder =
          Array.isArray(toolOrderRaw) &&
          toolOrderRaw.length > 0 &&
          toolOrderRaw.every((x) => typeof x === "string")
            ? (toolOrderRaw)
            : undefined;
        const toolSettleRaw = loop.toolSettle;
        const toolSettle =
          toolSettleRaw === "serial" || toolSettleRaw === "parallel"
            ? toolSettleRaw
            : undefined;
        const llmRetryMaxRetriesRaw = loop.llmRetryMaxRetries;
        const llmRetryMaxRetries =
          typeof llmRetryMaxRetriesRaw === "number" &&
          Number.isFinite(llmRetryMaxRetriesRaw) &&
          llmRetryMaxRetriesRaw >= 0
            ? Math.floor(llmRetryMaxRetriesRaw)
            : undefined;
        const maxRequestTokens =
          typeof loop.maxRequestTokens === "number" &&
          Number.isFinite(loop.maxRequestTokens) &&
          loop.maxRequestTokens >= 8_000
            ? Math.floor(loop.maxRequestTokens)
            : undefined;
        const keepTokens =
          typeof loop.keepTokens === "number" &&
          Number.isFinite(loop.keepTokens) &&
          loop.keepTokens >= 2_000
            ? Math.floor(loop.keepTokens)
            : undefined;
        const bufferTokens =
          typeof loop.bufferTokens === "number" &&
          Number.isFinite(loop.bufferTokens) &&
          loop.bufferTokens >= 0
            ? Math.floor(loop.bufferTokens)
            : undefined;
        const compactionStrategyRaw = String(
          loop.compactionStrategy ?? "",
        ).trim();
        const compactionStrategy =
          compactionStrategyRaw === "prune-summary" ||
          compactionStrategyRaw === "prune-only" ||
          compactionStrategyRaw === "summary-only" ||
          compactionStrategyRaw === "off"
            ? compactionStrategyRaw
            : undefined;
        const guardianFragments =
          typeof loop.guardianFragments === "boolean"
            ? loop.guardianFragments
            : undefined;
        const toolResultMaxInlineBytes =
          typeof loop.toolResultMaxInlineBytes === "number" &&
          Number.isFinite(loop.toolResultMaxInlineBytes) &&
          loop.toolResultMaxInlineBytes >= 0
            ? Math.floor(loop.toolResultMaxInlineBytes)
            : undefined;
        const maxSubagentDepth =
          typeof loop.maxSubagentDepth === "number" &&
          Number.isFinite(loop.maxSubagentDepth) &&
          loop.maxSubagentDepth >= 1
            ? Math.min(3, Math.floor(loop.maxSubagentDepth))
            : undefined;
        const maxActiveSubagents =
          typeof loop.maxActiveSubagents === "number" &&
          Number.isFinite(loop.maxActiveSubagents) &&
          loop.maxActiveSubagents >= 1
            ? Math.min(16, Math.floor(loop.maxActiveSubagents))
            : undefined;
        const timeoutMs =
          typeof bash.timeoutMs === "number" &&
          Number.isFinite(bash.timeoutMs) &&
          bash.timeoutMs > 0
            ? Math.floor(bash.timeoutMs)
            : undefined;
        // DSH bash-local default 64_000 — always present so capture is bounded.
        const maxOutputBytes =
          typeof bash.maxOutputBytes === "number" &&
          Number.isFinite(bash.maxOutputBytes) &&
          bash.maxOutputBytes > 0
            ? Math.floor(bash.maxOutputBytes)
            : 64_000;
        const foregroundYieldMs =
          typeof bash.foregroundYieldMs === "number" &&
          Number.isFinite(bash.foregroundYieldMs) &&
          bash.foregroundYieldMs >= 250
            ? Math.min(30_000, Math.floor(bash.foregroundYieldMs))
            : undefined;
        const provider =
          typeof webSearchNs.provider === "string"
            ? webSearchNs.provider.trim()
            : "";
        const region =
          typeof webSearchNs.region === "string"
            ? webSearchNs.region.trim()
            : "";
        const tavily = faceRuntime.credentials.peek("web.tavily");
        const brave = faceRuntime.credentials.peek("web.brave");
        const webSearch: import("@xrkseek/exec-web").SearchAccessConfig = {
          ...(provider && provider !== "auto" ? { provider } : {}),
          ...(region ? { region } : {}),
          ...(tavily || process.env.XRK_TAVILY_API_KEY?.trim()
            ? {
                tavilyApiKey:
                  tavily ?? process.env.XRK_TAVILY_API_KEY?.trim() ?? "",
              }
            : {}),
          ...(brave || process.env.XRK_BRAVE_SEARCH_API_KEY?.trim()
            ? {
                braveApiKey:
                  brave ?? process.env.XRK_BRAVE_SEARCH_API_KEY?.trim() ?? "",
              }
            : {}),
        };
        const injectMaxCharsRaw = injectNs.injectMaxChars;
        const injectMaxChars =
          typeof injectMaxCharsRaw === "number" &&
          Number.isFinite(injectMaxCharsRaw) &&
          injectMaxCharsRaw >= 4_000
            ? Math.min(128_000, Math.floor(injectMaxCharsRaw))
            : undefined;
        const telModeRaw =
          typeof telemetryNs.mode === "string"
            ? telemetryNs.mode.trim().toLowerCase()
            : "off";
        const telMode =
          telModeRaw === "memory" || telModeRaw === "otlp" || telModeRaw === "off"
            ? telModeRaw
            : "off";
        const telEndpoint =
          typeof telemetryNs.endpoint === "string" && telemetryNs.endpoint.trim()
            ? telemetryNs.endpoint.trim()
            : undefined;
        const sessionTelemetry: import("@xrkseek/session-telemetry").SessionTelemetryProductConfig =
          {
            mode: telMode,
            ...(telEndpoint ? { endpoint: telEndpoint } : {}),
          };
        const sandboxNs = faceRuntime.settingsNamespaces.view("sandbox")
          .value as Record<string, unknown>;
        const sbBackendRaw =
          typeof sandboxNs.backend === "string"
            ? sandboxNs.backend.trim().toLowerCase()
            : "workspace";
        const sbBackend =
          sbBackendRaw === "docker" ||
          sbBackendRaw === "bwrap" ||
          sbBackendRaw === "windows" ||
          sbBackendRaw === "workspace"
            ? sbBackendRaw
            : "workspace";
        const sbImage =
          typeof sandboxNs.dockerImage === "string" && sandboxNs.dockerImage.trim()
            ? sandboxNs.dockerImage.trim()
            : undefined;
        const sbNetRaw =
          typeof sandboxNs.dockerNetwork === "string"
            ? sandboxNs.dockerNetwork.trim().toLowerCase()
            : "";
        const sbNetwork =
          sbNetRaw === "bridge" || sbNetRaw === "none" ? sbNetRaw : undefined;
        const sbModeRaw =
          typeof sandboxNs.windowsMode === "string"
            ? sandboxNs.windowsMode.trim()
            : "";
        const sbMode =
          sbModeRaw === "workspace-write" ||
          sbModeRaw === "read-only" ||
          sbModeRaw === "danger-full-access"
            ? sbModeRaw
            : undefined;
        const sandbox: import("@xrkseek/exec-sandbox").SandboxProductConfig = {
          backend: sbBackend,
          ...(sbImage ? { dockerImage: sbImage } : {}),
          ...(sbNetwork ? { dockerNetwork: sbNetwork } : {}),
          ...(sbMode ? { windowsMode: sbMode } : {}),
        };
        const computerUseNs = faceRuntime.settingsNamespaces.view("computer-use")
          .value as Record<string, unknown>;
        const cuModeRaw =
          typeof computerUseNs.mode === "string"
            ? computerUseNs.mode.trim().toLowerCase()
            : "off";
        const computerUseProduct: import("@xrkseek/exec-computer-use").ComputerUseProductConfig =
          {
            mode:
              cuModeRaw === "uia" || cuModeRaw === "background"
                ? cuModeRaw
                : "off",
          };
        const backgroundHelper =
          faceRuntime.credentials.peek("computer.background")?.trim() ||
          process.env.XRK_COMPUTER_USE_BACKGROUND?.trim() ||
          "";
        const computerUseEnv: NodeJS.ProcessEnv | undefined = backgroundHelper
          ? {
              ...process.env,
              XRK_COMPUTER_USE_BACKGROUND: backgroundHelper,
            }
          : undefined;
        const browserNs = faceRuntime.settingsNamespaces.view("browser")
          .value as Record<string, unknown>;
        const brModeRaw =
          typeof browserNs.mode === "string"
            ? browserNs.mode.trim().toLowerCase()
            : "http";
        const brCdpUrl =
          typeof browserNs.cdpUrl === "string" && browserNs.cdpUrl.trim()
            ? browserNs.cdpUrl.trim()
            : undefined;
        const browserProduct: import("@xrkseek/exec-web").BrowserProductConfig = {
          mode: brModeRaw === "cdp" ? "cdp" : "http",
          ...(brCdpUrl ? { cdpUrl: brCdpUrl } : {}),
        };
        const voiceNs = faceRuntime.settingsNamespaces.view("voice")
          .value as Record<string, unknown>;
        const voiceModeRaw =
          typeof voiceNs.mode === "string"
            ? voiceNs.mode.trim().toLowerCase()
            : "off";
        const voiceBase =
          typeof voiceNs.baseUrl === "string" && voiceNs.baseUrl.trim()
            ? voiceNs.baseUrl.trim()
            : undefined;
        const voiceProduct: import("@xrkseek/exec-voice").VoiceProductConfig = {
          mode: voiceModeRaw === "openai" ? "openai" : "off",
          ...(voiceBase ? { baseUrl: voiceBase } : {}),
        };
        const voiceKey =
          faceRuntime.credentials.peek("voice.openai")?.trim() ||
          process.env.XRK_VOICE_OPENAI_KEY?.trim() ||
          "";
        const voiceEnv: NodeJS.ProcessEnv | undefined = voiceKey
          ? { ...process.env, XRK_VOICE_OPENAI_KEY: voiceKey }
          : undefined;
        const imageNs = faceRuntime.settingsNamespaces.view("image-gen")
          .value as Record<string, unknown>;
        const imageModeRaw =
          typeof imageNs.mode === "string"
            ? imageNs.mode.trim().toLowerCase()
            : "off";
        const imageBase =
          typeof imageNs.baseUrl === "string" && imageNs.baseUrl.trim()
            ? imageNs.baseUrl.trim()
            : undefined;
        const imageModel =
          typeof imageNs.model === "string" && imageNs.model.trim()
            ? imageNs.model.trim()
            : undefined;
        const imageGenProduct: import("@xrkseek/exec-image-gen").ImageGenProductConfig =
          {
            mode: imageModeRaw === "openai" ? "openai" : "off",
            ...(imageBase ? { baseUrl: imageBase } : {}),
            ...(imageModel ? { model: imageModel } : {}),
          };
        const imageKey =
          faceRuntime.credentials.peek("image.openai")?.trim() ||
          process.env.XRK_IMAGE_GEN_OPENAI_KEY?.trim() ||
          "";
        const imageGenEnv: NodeJS.ProcessEnv | undefined = imageKey
          ? { ...process.env, XRK_IMAGE_GEN_OPENAI_KEY: imageKey }
          : undefined;
        const videoNs = faceRuntime.settingsNamespaces.view("video-gen")
          .value as Record<string, unknown>;
        const videoModeRaw =
          typeof videoNs.mode === "string"
            ? videoNs.mode.trim().toLowerCase()
            : "off";
        const videoBase =
          typeof videoNs.baseUrl === "string" && videoNs.baseUrl.trim()
            ? videoNs.baseUrl.trim()
            : undefined;
        const videoModel =
          typeof videoNs.model === "string" && videoNs.model.trim()
            ? videoNs.model.trim()
            : undefined;
        const videoGenProduct: import("@xrkseek/exec-video-gen").VideoGenProductConfig =
          {
            mode: videoModeRaw === "openai" ? "openai" : "off",
            ...(videoBase ? { baseUrl: videoBase } : {}),
            ...(videoModel ? { model: videoModel } : {}),
          };
        const videoKey =
          faceRuntime.credentials.peek("video.openai")?.trim() ||
          process.env.XRK_VIDEO_GEN_OPENAI_KEY?.trim() ||
          "";
        const videoGenEnv: NodeJS.ProcessEnv | undefined = videoKey
          ? { ...process.env, XRK_VIDEO_GEN_OPENAI_KEY: videoKey }
          : undefined;
        const videoAnalyzeNs = faceRuntime.settingsNamespaces.view(
          "video-analyze",
        ).value as Record<string, unknown>;
        const videoAnalyzeModeRaw =
          typeof videoAnalyzeNs.mode === "string"
            ? videoAnalyzeNs.mode.trim().toLowerCase()
            : "off";
        const videoAnalyzeBase =
          typeof videoAnalyzeNs.baseUrl === "string" &&
          videoAnalyzeNs.baseUrl.trim()
            ? videoAnalyzeNs.baseUrl.trim()
            : undefined;
        const videoAnalyzeModel =
          typeof videoAnalyzeNs.model === "string" &&
          videoAnalyzeNs.model.trim()
            ? videoAnalyzeNs.model.trim()
            : undefined;
        const videoAnalyzeProduct: import("@xrkseek/exec-video-analyze").VideoAnalyzeProductConfig =
          {
            mode: videoAnalyzeModeRaw === "openai" ? "openai" : "off",
            ...(videoAnalyzeBase ? { baseUrl: videoAnalyzeBase } : {}),
            ...(videoAnalyzeModel ? { model: videoAnalyzeModel } : {}),
          };
        const videoAnalyzeKey =
          faceRuntime.credentials.peek("video-analyze.openai")?.trim() ||
          process.env.XRK_VIDEO_ANALYZE_OPENAI_KEY?.trim() ||
          "";
        const videoAnalyzeEnv: NodeJS.ProcessEnv | undefined = videoAnalyzeKey
          ? { ...process.env, XRK_VIDEO_ANALYZE_OPENAI_KEY: videoAnalyzeKey }
          : undefined;
        const localeNs = faceRuntime.settingsNamespaces.view("locale")
          .value as Record<string, unknown>;
        const asLocale = (raw: unknown): "zh" | "en" | undefined =>
          raw === "zh" || raw === "en" ? raw : undefined;
        // Explicit Settings choice wins; older desktop builds stored the shell
        // language in the `ui` namespace (`ui.locale`) and never wrote
        // `locale.preference`, so honour it instead of dropping to the
        // language-agnostic prompt fallback (reasoning drifted to English).
        const localePref =
          asLocale(localeNs.preference) ??
          asLocale(
            (
              faceRuntime.settingsNamespaces.view("ui")
                .value as Record<string, unknown>
            ).locale,
          );
        const memNs = faceRuntime.settingsNamespaces.view("curated-memory")
          .value as Record<string, unknown>;
        const memFaceOn = memNs.enabled !== false;
        const memEnvRaw = String(process.env.XRK_CURATED_MEMORY ?? "").trim();
        const curatedMemoryEnabled =
          memEnvRaw !== "" ? memEnvRaw !== "0" : memFaceOn;
        return {
          ...(maxParallelToolCalls !== undefined ? { maxParallelToolCalls } : {}),
          ...(maxSteps !== undefined ? { maxSteps } : {}),
          ...(autoContinueOnMaxTokens
            ? { autoContinueOnMaxTokens: true }
            : {}),
          ...(autoContinueMaxRounds !== undefined
            ? { autoContinueMaxRounds }
            : {}),
          ...(toolOrder !== undefined ? { toolOrder } : {}),
          ...(toolSettle !== undefined ? { toolSettle } : {}),
          ...(llmRetryMaxRetries !== undefined ? { llmRetryMaxRetries } : {}),
          ...(maxRequestTokens !== undefined ||
          keepTokens !== undefined ||
          bufferTokens !== undefined ||
          compactionStrategy !== undefined
            ? {
                compaction: {
                  ...(maxRequestTokens !== undefined
                    ? { maxRequestTokens }
                    : {}),
                  ...(keepTokens !== undefined ? { keepTokens } : {}),
                  ...(bufferTokens !== undefined ? { bufferTokens } : {}),
                  ...(compactionStrategy !== undefined
                    ? { strategy: compactionStrategy }
                    : {}),
                },
              }
            : {}),
          ...(toolResultMaxInlineBytes !== undefined
            ? { toolResultMaxInlineBytes }
            : {}),
          ...(guardianFragments !== undefined ? { guardianFragments } : {}),
          ...(maxSubagentDepth !== undefined ? { maxSubagentDepth } : {}),
          ...(maxActiveSubagents !== undefined ? { maxActiveSubagents } : {}),
          bashLimits: {
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            maxOutputBytes,
            ...(foregroundYieldMs !== undefined
              ? { foregroundYieldMs }
              : {}),
          },
          webSearch,
          ...(injectMaxChars !== undefined
            ? { workspaceInject: { maxChars: injectMaxChars } }
            : {}),
          sessionTelemetry,
          sandbox,
          computerUseProduct,
          ...(computerUseEnv ? { computerUseEnv } : {}),
          browserProduct,
          voiceProduct,
          ...(voiceEnv ? { voiceEnv } : {}),
          imageGenProduct,
          ...(imageGenEnv ? { imageGenEnv } : {}),
          videoGenProduct,
          ...(videoGenEnv ? { videoGenEnv } : {}),
          videoAnalyzeProduct,
          ...(videoAnalyzeEnv ? { videoAnalyzeEnv } : {}),
          ...(!curatedMemoryEnabled ? { curatedMemory: false as const } : {}),
          ...(localePref ? { locale: localePref } : {}),
        };
      };
      {
        const cronNs = faceRuntime.settingsNamespaces.view("cron")
          .value as Record<string, unknown>;
        applyCronScheduler({ enabled: cronNs.enabled !== false });
      }
      faceRuntime.bus.subscribeHost((_rpcId, frame) => {
        if (frame.type !== "host/remote-event") return;
        const event = frame.event;
        if (
          event === "llm/adapters-updated" ||
          event === "credentials/updated"
        ) {
          void invalidateAgents();
          return;
        }
        if (event === "settings/document-updated") {
          const ns = frame.args[0];
          if (ns === "cron") {
            const cronNs = faceRuntime.settingsNamespaces.view("cron")
              .value as Record<string, unknown>;
            const changed = applyCronScheduler({
              enabled: cronNs.enabled !== false,
            });
            if (changed) void invalidateAgents();
            return;
          }
          if (
            ns === "agent-default-model" ||
            ns === "llm-deepseek" ||
            ns === "llm-pi-ai" ||
            ns === "agent-loop" ||
            ns === "bash" ||
            ns === "web-search" ||
            ns === "sandbox" ||
            ns === "computer-use" ||
            ns === "browser" ||
            ns === "voice" ||
            ns === "image-gen" ||
            ns === "video-gen" ||
            ns === "curated-memory" ||
            ns === "locale"
          ) {
            void invalidateAgents();
          }
        }
      });
      lineage.parentOf = (sessionId) =>
        faceRuntime.subagents.getByChild(sessionId)?.parentSessionId;
      notifyMcpOverlay = () => {
        refreshFacePlugins();
        const slot = faceRuntime.settingsNamespaces.ensure("mcp");
        publishRemoteEvent(faceRuntime.bus, "settings/document-updated", [
          "mcp",
          slot.revision,
        ]);
      };

      const mobileAccessGate = createMobileAccessGateChecker({
        xrkHome: resolveXrkHome(),
      });

      const faceCheckAuth = (r: IncomingMessage) => {
        if (!mobileAccessGate(r)) return false;
        const expected = effectiveHostApiKey(faceRuntime);
        if (!expected) return true;
        const auth = r.headers.authorization;
        const headerKey = r.headers["x-api-key"];
        const bearer =
          typeof auth === "string" && auth.startsWith("Bearer ")
            ? auth.slice("Bearer ".length)
            : undefined;
        const key =
          bearer ?? (typeof headerKey === "string" ? headerKey : undefined);
        if (key === expected) return true;
        // DSH Web 同源不带 Authorization；本机回环放行。
        return !key && isLoopbackAddress(r.socket.remoteAddress);
      };

      await ensureDshCompatHostPlugin(loader);
      refreshFacePlugins();

      const hostWireCtx = {
        pluginsDir: resolvedPluginsDir,
        xrkHome: resolveXrkHome(),
        workspaceRoot: faceRuntime.workspaceRoot,
        defaultCwd: faceRuntime.workspaceRoot,
        resolveSessionCwd: (sessionId: string) =>
          resolveSessionCwd(faceRuntime, sessionId),
        resolveAutoReviewClassifierProduct: () => {
          const ns = faceRuntime.settingsNamespaces.view("auto-review")
            .value as Record<string, unknown>;
          const classifierUrl =
            typeof ns.classifierUrl === "string" ? ns.classifierUrl.trim() : "";
          const classifierToken =
            faceRuntime.credentials.peek("auto-review.classifier")?.trim() ||
            process.env.XRK_AUTO_REVIEW_CLASSIFIER_TOKEN?.trim() ||
            "";
          return {
            ...(classifierUrl ? { classifierUrl } : {}),
            ...(classifierToken ? { classifierToken } : {}),
          };
        },
        resolveMemoryEmbedProduct: () => {
          const ns = faceRuntime.settingsNamespaces.view("memory-embed")
            .value as Record<string, unknown>;
          const url = typeof ns.url === "string" ? ns.url.trim() : "";
          const collection =
            typeof ns.collection === "string" ? ns.collection.trim() : "";
          const token =
            faceRuntime.credentials.peek("memory-embed.token")?.trim() ||
            process.env.XRK_MEMORY_EMBED_TOKEN?.trim() ||
            "";
          return {
            ...(url ? { url } : {}),
            ...(token ? { token } : {}),
            ...(collection ? { collection } : {}),
            ...(typeof ns.embeddingsUrl === "string" && ns.embeddingsUrl.trim()
              ? { embeddingsUrl: ns.embeddingsUrl.trim() }
              : {}),
            ...(typeof ns.embeddingsModel === "string" &&
            ns.embeddingsModel.trim()
              ? { embeddingsModel: ns.embeddingsModel.trim() }
              : {}),
          };
        },
        tokenLedger: {
          ...createCostMeterUsageBridge(faceRuntime),
          ...createUsageStatsBridgeFromFace(faceRuntime),
        },
        walletPort: createXrkWalletPort({
          xrkHome: resolveXrkHome(),
          face: createWalletFaceBridgeFromFace(faceRuntime),
        }),
        sidebarFace: createSidebarFaceBridgeFromFace(faceRuntime, {
          ...(sharedShell ? { shell: sharedShell } : {}),
        }),
        harnessConnector: createHarnessConnectorBridgeFromFace(faceRuntime),
        policy,
        resolvePolicyAsk: async (args: {
          readonly subject: { readonly kind: string };
          readonly reason: string;
          readonly sessionId?: string;
        }) => {
          if (!args.sessionId) return undefined;
          return faceRuntime.approvals.requestHostGate(args.sessionId, {
            kind: args.subject.kind,
            reason: args.reason,
            summary: JSON.stringify(args.subject),
          });
        },
      };
      hostWireRef.ctx = hostWireCtx;

      await prewarmDshCompatAdapters(hostWireCtx);
      syncCordisHostApplied();

      const http = createHttpServer({
        host: config.runtime.host,
        port: config.runtime.port,
        apiKey: config.credentials.apiKey,
        corsOrigin: config.runtime.corsOrigin,
        rateLimitPerMinute: config.runtime.rateLimitPerMinute,
        store,
        ensureSession,
        resolveAgent,
        drain,
        tryHandlePublic: chainPublicHandlers(
          createA2aInboundPublicHandler({
            host: config.runtime.host,
            port: config.runtime.port,
            face: faceRuntime,
            resolveProduct: () => {
              try {
                const ns = faceRuntime.settingsNamespaces.view("a2a-inbound")
                  .value as Record<string, unknown>;
                return {
                  enabled: ns.enabled === true,
                  ...(typeof ns.sessionId === "string"
                    ? { sessionId: ns.sessionId }
                    : {}),
                  ...(typeof ns.timeoutMs === "number"
                    ? { timeoutMs: ns.timeoutMs }
                    : {}),
                };
              } catch {
                return undefined;
              }
            },
          }),
          createMobileAccessGateHandler({ xrkHome: resolveXrkHome() }),
          createSidebarPublicHandler({
            xrkHome: resolveXrkHome(),
            defaultCwd: faceRuntime.workspaceRoot,
            resolveSessionCwd: (sessionId: string) =>
              resolveSessionCwd(faceRuntime, sessionId),
            sidebarFace: hostWireCtx.sidebarFace,
            pluginsDir: resolvedPluginsDir,
            agentRegistries: {
              closeAgentPty: (uuid) => agentPtyRegistry.close(uuid),
            },
            policy,
            resolvePolicyAsk: hostWireCtx.resolvePolicyAsk,
            onPrefsChanged: (_value, patch) => {
              if (
                Object.prototype.hasOwnProperty.call(patch, "agentOpenTools") ||
                Object.prototype.hasOwnProperty.call(patch, "agentTerminalTools")
              ) {
                void invalidateAgents();
              }
            },
          }),
          createXrkPluginPublicHandler({
            pluginsDir: resolvedPluginsDir,
            xrkHome: resolveXrkHome(),
          }),
          createLiveHostPluginsPublicHandler(
            () => loader.list(),
            hostWireCtx,
          ),
        ),
        ...(log
          ? {
              onAccess: (info) => {
                log.debug(
                  `http ${info.method} ${info.path} → ${info.status}`,
                );
              },
            }
          : {}),
        ...(config.runtime.webDist
          ? {
              webStatic: {
                root: config.runtime.webDist,
                ...(webOverlay ? { extraRoots: [webOverlay] } : {}),
                transformIndex: (html: string) =>
                  injectMobileAccessShellIntoHtml(
                    injectBootIntoHtml(html, boot),
                  ),
              },
            }
          : {}),
        tryHandleExtraApi: (req, res) =>
          tryHandleFaceHttp(req, res, faceRuntime, {
            apiKey: effectiveHostApiKey(faceRuntime),
            checkAuth: faceCheckAuth,
          }),
        attachExtras: (server) => {
          const face = attachFaceUpgrades(server, faceRuntime, {
            apiKey: effectiveHostApiKey(faceRuntime),
            checkAuth: faceCheckAuth,
          });
          const dshUpgrades = attachDshCompatUpgrades(server, {
            checkAuth: faceCheckAuth,
          });
          // Sidebar interactive PTY is Host-local node-pty — not SSH. Skip when
          // remote so defaultCwd is never a remote POSIX path on the Host disk.
          const sidebarPty = sshWorld
            ? { close() {} }
            : attachSidebarPtyUpgrades(server, {
                defaultCwd: faceRuntime.workspaceRoot,
                checkAuth: faceCheckAuth,
                agentPty: agentPtyRegistry,
                agentOpens: agentOpenRegistry,
              });
          return {
            close() {
              sidebarPty.close();
              agentPtyRegistry.disposeAll();
              agentOpenRegistry.dispose();
              dshUpgrades.close();
              face.close();
              shutdownDshCompatServices();
            },
          };
        },
      });

      const shouldListen = config.runtime.listen !== false;
      const addr = shouldListen
        ? await http.listen()
        : { host: config.runtime.host, port: 0 };
      if (shouldListen) {
        log?.info(`listening ${config.runtime.host}:${addr.port}`);
      } else {
        log?.info("http stack ready (listen disabled — pipe / fetch transport)");
      }
      let status: HostInstance["status"] = "running";
      let stopPromise: Promise<void> | undefined;

      const instance: HostInstance = {
        id,
        config,
        store,
        loader,
        get loadedPluginIds() {
          return loadedPluginIds;
        },
        http,
        drain,
        get status() {
          return status;
        },
        health() {
          return {
            ok: status === "running",
            status,
            ...(shouldListen ? { port: addr.port } : {}),
            mcpAllowConnect,
            ...(loadedPluginIds.length
              ? { plugins: loadedPluginIds }
              : {}),
          };
        },
        async stop() {
          if (stopPromise) return stopPromise;
          status = "stopped";
          stopPromise = (async () => {
            cronBox.scheduler?.stop();
            policyFileWatch?.dispose();
            // Phase1 consolidate before agents/store go away (Hermes finalize).
            for (const sessionId of store.list()) {
              consolidateCuratedMemoryForSession(sessionId);
            }
            runWorkspaceSkillCurator();
            await http.close();
            await agentCache.dispose();
            if (sharedShell) {
              try {
                await sharedShell.dispose();
              } catch {
                // Host stop must continue even if jobs teardown partially fails.
              }
            }
            if (sharedBrowser) {
              try {
                sharedBrowser.dispose();
              } catch {
                // Host stop must continue even if browser CDP teardown fails.
              }
            }
            if (sshWorld) {
              try {
                sshWorld.dispose();
              } catch {
                // Host stop must continue even if SSH ControlMaster exit fails.
              }
            }
            if (sharedPty) {
              try {
                await sharedPty.service.dispose();
              } catch {
                // Host stop must continue even if PTY cleanup partially fails.
              }
            }
            if ("close" in store && typeof store.close === "function") {
              store.close();
            }
            invariantsRegistry?.dispose();
            for (const p of loader.list()) {
              await loader.unregister(p.id);
            }
            instances.delete(id);
          })();
          return stopPromise;
        },
      };

      instances.set(id, instance);
      return instance;
    },

    get(id) {
      return instances.get(id);
    },

    list() {
      return [...instances.values()];
    },

    async stop(id) {
      const inst = instances.get(id);
      if (inst) await inst.stop();
    },

    async stopAll() {
      await Promise.all([...instances.values()].map((i) => i.stop()));
    },
  };
}
