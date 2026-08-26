import type { AgentHandle, AgentRunResult } from "@xrkseek/core-agent";
import type { LlmAdapter } from "@xrkseek/llm";
import { createLocalAttachmentStore } from "@xrkseek/attachment-local";
import {
  createMemorySessionStore,
  createPersistentSessionStore,
  createSessionDrainHub,
  newSession,
  type SessionDrainHub,
  type SessionStore,
} from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { createPolicyEngineFromFile } from "@xrkseek/policy";
import { hostSettingsPath, resolveXrkHome, type HostConfig } from "@xrkseek/server-config";
import {
  applyXrkProductBootPolicy,
  chainPublicHandlers,
  ensureDshCompatHostPlugin,
  createHostPluginsPublicHandler,
  createHttpServer,
  createXrkPluginPublicHandler,
  prewarmDshCompatAdapters,
  shutdownDshCompatServices,
  applyHostPackageByName,
  stopHostPackageFiber,
  listHostAppliedPackages,
  invokeDshCompatRpc,
  attachDshCompatUpgrades,
  DSH_SETTINGS_NAMESPACES,
  DSH_SETTINGS_DEFAULTS,
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
} from "@xrkseek/server-http";
import {
  attachFaceUpgrades,
  bindSubagentTools,
  createFaceRuntime,
  effectiveHostApiKey,
  isLoopbackAddress,
  publishRemoteEvent,
  createSessionRoutingLlm,
  liveRouteAllowsImageInput,
  resolveSessionCwd,
  canonicalAgentPresetId,
  tryHandleFaceHttp,
  type FaceApprovalBroker,
  type FaceQuestionBroker,
  type FaceRuntime,
} from "@xrkseek/server-face";
import {
  createPluginLoader,
  wireCompositionChannels,
  wireCompositionLlm,
  collectChannelPluginRegistrations,
  type PluginLoader,
  type RegisteredPlugin,
} from "@xrkseek/server-loader";
import { access } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { createHostAgentCache } from "./agent-cache.js";
import { wireDrainStatus, publishDrainIdle, type SessionDrainControl } from "./drain-status.js";
import { attachSidebarPtyUpgrades } from "./sidebar-pty.js";
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
import { createStandingToolRegistry } from "./standing-tools.js";
import { createDefaultPtyAccess } from "@xrkseek/exec-pty";
import { createLocalShell } from "@xrkseek/exec-shell";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import type { HostLogger, HostSpawnOptions } from "./log.js";

export { createHostAgentCache, HOST_PLUGINS_KEY } from "./agent-cache.js";
export { createStandingToolRegistry } from "./standing-tools.js";
export type { AgentResolveOpts, HostAgentCache } from "./agent-cache.js";
export type { HostLogger, HostSpawnOptions } from "./log.js";
export {
  loadMcpToolPlugins,
  mcpDraftsToSpecs,
  mcpFingerprint,
  parseMcpServersEnv,
  readMcpAllowFromHostSettings,
  readMcpServersFromHostSettings,
  reconcileMcpToolPlugins,
  type McpRegisteredPlugin,
  type McpServerDraft,
  type McpServerSpec,
  type ReconcileMcpResult,
} from "./mcp-wire.js";

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
  /** Shared attachment store for tools + vision. */
  attachments?: import("@xrkseek/attachment").AttachmentStore;
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
  };
  /** Face `agent-loop` soft compaction budget (harness). */
  compaction?: {
    maxRequestTokens?: number;
    keepTokens?: number;
    bufferTokens?: number;
  };
  /** Face `agent-loop.toolResultMaxInlineBytes` — spill ceiling (`0` disables). */
  toolResultMaxInlineBytes?: number;
  /** Merged Face web-search + vault keys for `createDefaultWebAccess({ search })`. */
  webSearch?: import("@xrkseek/exec-web").SearchAccessConfig;
  /** Face `workspace-inject.injectMaxChars` — rules/skills inject budget. */
  workspaceInject?: { readonly maxChars?: number };
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
      const id = `host_${++seq}`;
      const sessionsDir = config.runtime.sessionsDir?.trim();
      const store: SessionStore = sessionsDir
        ? createPersistentSessionStore(sessionsDir)
        : createMemorySessionStore();
      const loader = createPluginLoader();
      const registry = createProviderRegistry();

      let loadedPluginIds: string[] = [];
      if (config.runtime.pluginsDir) {
        loadedPluginIds = [...(await loader.loadAll(config.runtime.pluginsDir))];
      }

      const policy = config.runtime.policyFile
        ? await createPolicyEngineFromFile(config.runtime.policyFile)
        : undefined;

      const hostPublic = {
        host: config.runtime.host,
        port: config.runtime.port,
        workspaceRoot: config.runtime.workspaceRoot,
        preset: config.runtime.preset,
        corsOrigin: String(config.runtime.corsOrigin),
        rateLimitPerMinute: config.runtime.rateLimitPerMinute,
        ...(config.runtime.pluginsDir
          ? { pluginsDir: config.runtime.pluginsDir }
          : {}),
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
      /** Mutable Face inventory — Host splices after MCP reconcile / health. */
      const facePlugins: RegisteredPlugin[] = [];
      const refreshFacePlugins = () => {
        facePlugins.splice(0, facePlugins.length, ...loader.list());
        wireCompositionLlm(registry, { plugins: loader.list() });
        wireCompositionChannels({ plugins: loader.list() });
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
          unregister: async (pluginId) => {
            await loader.unregister(pluginId);
            loadedPluginIds = loadedPluginIds.filter((x) => x !== pluginId);
          },
          ...(policy ? { policy } : {}),
          allowConnect: mcpAllowConnect,
          imageAdmission: mcpImageAdmission,
          ...mcpHooks,
        });
        logMcpReconcile(log, "boot", boot);
      }
      refreshFacePlugins();

      const agentCache = createHostAgentCache(loader.list(), { hostId: id });
      invalidateAgents = () => agentCache.invalidateAll();
      let mcpSyncTail: Promise<unknown> = Promise.resolve();
      const lastDrainResult = new Map<string, AgentRunResult>();

      const sharedPty =
        config.runtime.preset === "harness" || config.runtime.preset === "server"
          ? createDefaultPtyAccess({
              workspaceRoot: config.runtime.workspaceRoot,
            })
          : undefined;

      const sharedShell =
        config.runtime.preset === "harness" || config.runtime.preset === "server"
          ? createLocalShell({ subprocess: createLocalSubprocess() })
          : undefined;

      const ensureSession = (sid?: string) => newSession(store, sid).id;

      const faceBox: {
        approvals?: FaceApprovalBroker;
        questions?: FaceQuestionBroker;
        runtime?: FaceRuntime;
      } = {};
      const llmResolverBox: {
        resolve?: (sessionId: string) => LlmAdapter | undefined;
      } = {};
      const pluginSettingsBox: {
        read?: () => {
          maxParallelToolCalls?: number;
          maxSteps?: number;
          toolOrder?: readonly string[];
          toolSettle?: "serial" | "parallel";
          llmRetryMaxRetries?: number;
          bashLimits?: { timeoutMs?: number; maxOutputBytes?: number };
          compaction?: {
            maxRequestTokens?: number;
            keepTokens?: number;
            bufferTokens?: number;
          };
          toolResultMaxInlineBytes?: number;
          webSearch?: import("@xrkseek/exec-web").SearchAccessConfig;
          workspaceInject?: { readonly maxChars?: number };
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
              ...(sharedPty ? { ptyService: sharedPty.service } : {}),
              ...(sharedShell ? { shellJobs: sharedShell } : {}),
              ...(llmResolverBox.resolve
                ? { resolveLlm: llmResolverBox.resolve }
                : {}),
              ...(pluginSettings.maxParallelToolCalls !== undefined
                ? { maxParallelToolCalls: pluginSettings.maxParallelToolCalls }
                : {}),
              ...(pluginSettings.maxSteps !== undefined
                ? { maxSteps: pluginSettings.maxSteps }
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
              ...(pluginSettings.webSearch
                ? { webSearch: pluginSettings.webSearch }
                : {}),
              ...(pluginSettings.workspaceInject
                ? { workspaceInject: pluginSettings.workspaceInject }
                : {}),
            });
            if (faceBox.approvals) {
              agent.setApprovalHandler(faceBox.approvals.handlerFor(sessionId));
            }
            // ask_user / exit_plan_mode: Face resolveAgent rebinds once.
            if (agent.tools && faceBox.runtime) {
              bindSubagentTools(agent.tools, {
                runtime: faceBox.runtime,
                parentSessionId: sessionId,
              });
            }
            return agent;
          },
          parentSessionId ? { parentSessionId } : undefined,
        );
      };

      const hub: SessionDrainHub = createSessionDrainHub({
        createDrain: (sessionId) => async ({ signal }) => {
          try {
            const agent = await resolveAgent(sessionId);
            // Delivery queue rule (docs/session-delivery.md §3):
            // one continueTurn ⇒ one promote; runTurn owns tool continuation
            // without promoting further inbox items. Loop until inbox empty.
            while (agent.pendingAdmits().length > 0) {
              if (signal.aborted) {
                throw new DOMException("aborted", "AbortError");
              }
              const result = await agent.continueTurn({ signal });
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

      const webOverlay = await resolveWebPluginOverlay(
        config.runtime.pluginsDir,
      );
      const boot = applyXrkProductBootPolicy(
        ensureXrkPlatformClientBootEntries(
          mergeWebBootManifests(
            resolveWebBootManifest(config.runtime.webDist),
            webOverlay ? loadBootManifestFromWebDist(webOverlay) : undefined,
          ),
          config.runtime.webDist,
        ),
      );
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
      const faceRuntime = createFaceRuntime({
        store,
        resolveAgent,
        workspaceRoot: config.runtime.workspaceRoot,
        // Face settings / credentials / workspaces.json / host-settings → harness home.
        productDir: resolveXrkHome(),
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
            }
          : {}),
        plugins: facePlugins,
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
                    unregister: async (pluginId) => {
                      await loader.unregister(pluginId);
                      loadedPluginIds = loadedPluginIds.filter(
                        (x) => x !== pluginId,
                      );
                    },
                    ...(policy ? { policy } : {}),
                    allowConnect: mcpAllowConnect,
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
          ? { webPlugins: boot.entries.map((e) => ({ id: e.id })) }
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
        ...(policy ? { policy } : {}),
        ...(config.runtime.policyFile
          ? { settingsDocumentPath: path.resolve(config.runtime.policyFile) }
          : {}),
        invalidateAgent: (sessionId) => agentCache.invalidate(sessionId),
        ...createAutoReviewBridgeFromHost(resolveXrkHome()),
        ...(sharedPty
          ? { hasPtyActivity: () => sharedPty.service.hasActivity() }
          : {}),
        drain: {
          wake: (sessionId) => drain.wake(sessionId),
          cancel: (sessionId) => drain.cancel(sessionId),
          isActive: (sessionId) => drain.isActive(sessionId),
          run: (sessionId) => hub.run(sessionId),
        },
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
        const toolResultMaxInlineBytes =
          typeof loop.toolResultMaxInlineBytes === "number" &&
          Number.isFinite(loop.toolResultMaxInlineBytes) &&
          loop.toolResultMaxInlineBytes >= 0
            ? Math.floor(loop.toolResultMaxInlineBytes)
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
        return {
          ...(maxParallelToolCalls !== undefined ? { maxParallelToolCalls } : {}),
          ...(maxSteps !== undefined ? { maxSteps } : {}),
          ...(toolOrder !== undefined ? { toolOrder } : {}),
          ...(toolSettle !== undefined ? { toolSettle } : {}),
          ...(llmRetryMaxRetries !== undefined ? { llmRetryMaxRetries } : {}),
          ...(maxRequestTokens !== undefined ||
          keepTokens !== undefined ||
          bufferTokens !== undefined
            ? {
                compaction: {
                  ...(maxRequestTokens !== undefined
                    ? { maxRequestTokens }
                    : {}),
                  ...(keepTokens !== undefined ? { keepTokens } : {}),
                  ...(bufferTokens !== undefined ? { bufferTokens } : {}),
                },
              }
            : {}),
          ...(toolResultMaxInlineBytes !== undefined
            ? { toolResultMaxInlineBytes }
            : {}),
          bashLimits: {
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            maxOutputBytes,
          },
          webSearch,
          ...(injectMaxChars !== undefined
            ? { workspaceInject: { maxChars: injectMaxChars } }
            : {}),
        };
      };
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
          if (
            ns === "agent-default-model" ||
            ns === "llm-deepseek" ||
            ns === "llm-pi-ai" ||
            ns === "agent-loop" ||
            ns === "bash" ||
            ns === "web-search"
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
        ...(config.runtime.pluginsDir
          ? { pluginsDir: config.runtime.pluginsDir }
          : {}),
        xrkHome: resolveXrkHome(),
        workspaceRoot: faceRuntime.workspaceRoot,
        defaultCwd: faceRuntime.workspaceRoot,
        resolveSessionCwd: (sessionId: string) =>
          resolveSessionCwd(faceRuntime, sessionId),
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
          createMobileAccessGateHandler({ xrkHome: resolveXrkHome() }),
          createXrkPluginPublicHandler({
            ...(config.runtime.pluginsDir
              ? { pluginsDir: config.runtime.pluginsDir }
              : {}),
            xrkHome: resolveXrkHome(),
          }),
          createHostPluginsPublicHandler(loader.list(), hostWireCtx),
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
          const sidebarPty = attachSidebarPtyUpgrades(server, {
            defaultCwd: faceRuntime.workspaceRoot,
            checkAuth: faceCheckAuth,
          });
          return {
            close() {
              sidebarPty.close();
              dshUpgrades.close();
              face.close();
              shutdownDshCompatServices();
            },
          };
        },
      });

      const addr = await http.listen();
      log?.info(`listening ${config.runtime.host}:${addr.port}`);
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
            port: addr.port,
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
            await http.close();
            await agentCache.dispose();
            if (sharedShell) {
              try {
                await sharedShell.dispose();
              } catch {
                // Host stop must continue even if jobs teardown partially fails.
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
