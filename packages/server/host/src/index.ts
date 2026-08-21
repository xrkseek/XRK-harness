import type { AgentHandle, AgentRunResult } from "@xrkseek/core-agent";
import type { LlmAdapter } from "@xrkseek/llm";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
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
  createHttpServer,
  type HarnessHttpServer,
  injectBootIntoHtml,
  loadBootManifestFromWebDist,
  mergeWebBootManifests,
  resolveWebBootManifest,
} from "@xrkseek/server-http";
import {
  attachFaceUpgrades,
  bindAskUserTool,
  bindExitPlanModeTool,
  createFaceRuntime,
  effectiveHostApiKey,
  formatQuestionAnswer,
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
  type PluginLoader,
  type RegisteredPlugin,
} from "@xrkseek/server-loader";
import { access } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { createHostAgentCache } from "./agent-cache.js";
import { wireDrainStatus, publishDrainIdle, type SessionDrainControl } from "./drain-status.js";
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

async function resolveOfficeAgentSeedDir(
  workspaceRoot: string,
): Promise<string | undefined> {
  const candidate = path.resolve(workspaceRoot, "templates", "office-agent");
  try {
    await access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

/** `{pluginsDir}/web` overlay: extra client.js + optional `boot.json`. */
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
) => Promise<{ readonly mediaType: string; readonly data: Uint8Array }>;

export type AgentFactory = (input: {
  sessionId: string;
  store: SessionStore;
  workspaceRoot: string;
  /**
   * Session Face `agentPreset` (header badge). Host factory must honor this for
   * tool composition — it is not cosmetic. Falls back to Host `--preset`.
   */
  agentPreset?: string;
  /** Plugins loaded by host (`XRK_PLUGINS_DIR` / register). Wire via `wireCompositionTools`. */
  plugins: readonly RegisteredPlugin[];
  /** Attachment bytes for vision user content (Host memory store). */
  resolveImage?: AgentImageResolver;
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
  /** Merged Face web-search + vault keys for `createDefaultWebAccess({ search })`. */
  webSearch?: import("@xrkseek/exec-web").SearchAccessConfig;
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

      let loadedPluginIds: string[] = [];
      if (config.runtime.pluginsDir) {
        loadedPluginIds = [...(await loader.loadAll(config.runtime.pluginsDir))];
      }

      const policy = config.runtime.policyFile
        ? await createPolicyEngineFromFile(config.runtime.policyFile)
        : undefined;

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
      };
      let notifyMcpOverlay: () => void = () => {
        refreshFacePlugins();
      };
      const attachments = createMemoryAttachmentStore();
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
          webSearch?: import("@xrkseek/exec-web").SearchAccessConfig;
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
        return agentCache.resolve(
          sessionId,
          async () => {
            const pluginSettings = pluginSettingsBox.read?.() ?? {};
            const agent = await factory({
              sessionId,
              store,
              workspaceRoot: sessionRoot,
              plugins: loader.list(),
              ...(agentPreset ? { agentPreset } : {}),
              resolveImage: async (attachmentId) => {
                const stored = await attachments.readImage(attachmentId);
                return {
                  mediaType: stored.ref.mediaType,
                  data: stored.data,
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
              ...(pluginSettings.webSearch
                ? { webSearch: pluginSettings.webSearch }
                : {}),
            });
            if (faceBox.approvals) {
              agent.setApprovalHandler(faceBox.approvals.handlerFor(sessionId));
            }
            if (faceBox.questions && agent.tools) {
              bindAskUserTool(agent.tools, (qs, signal) =>
                faceBox.questions!.ask(sessionId, qs, signal).then(formatQuestionAnswer),
              );
              bindExitPlanModeTool(agent.tools, store, sessionId, (qs, signal) =>
                faceBox.questions!.ask(sessionId, qs, signal),
              );
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

      const officeAgent = await resolveOfficeAgentSeedDir(
        config.runtime.workspaceRoot,
      );
      const webOverlay = await resolveWebPluginOverlay(
        config.runtime.pluginsDir,
      );
      const boot = applyXrkProductBootPolicy(
        mergeWebBootManifests(
          resolveWebBootManifest(config.runtime.webDist),
          webOverlay ? loadBootManifestFromWebDist(webOverlay) : undefined,
        ),
      );
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
        registry: createProviderRegistry(),
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
        hostPublic: {
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
        },
        bootstrapApiKey: config.credentials.apiKey,
        ...(officeAgent
          ? { seedTemplateDirs: { "office-agent": officeAgent } }
          : {}),
        ...(policy ? { policy } : {}),
        ...(config.runtime.policyFile
          ? { settingsDocumentPath: path.resolve(config.runtime.policyFile) }
          : {}),
        invalidateAgent: (sessionId) => agentCache.invalidate(sessionId),
        ...(sharedPty
          ? { hasPtyActivity: () => sharedPty.service.hasActivity() }
          : {}),
        drain: {
          wake: (sessionId) => drain.wake(sessionId),
          cancel: (sessionId) => drain.cancel(sessionId),
          isActive: (sessionId) => drain.isActive(sessionId),
        },
      });
      faceForModality.current = faceRuntime;
      faceBox.approvals = faceRuntime.approvals;
      faceBox.questions = faceRuntime.questions;
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
            ? (toolOrderRaw as string[])
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
        const timeoutMs =
          typeof bash.timeoutMs === "number" &&
          Number.isFinite(bash.timeoutMs) &&
          bash.timeoutMs > 0
            ? Math.floor(bash.timeoutMs)
            : undefined;
        const maxOutputBytes =
          typeof bash.maxOutputBytes === "number" &&
          Number.isFinite(bash.maxOutputBytes) &&
          bash.maxOutputBytes > 0
            ? Math.floor(bash.maxOutputBytes)
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
        return {
          ...(maxParallelToolCalls !== undefined ? { maxParallelToolCalls } : {}),
          ...(maxSteps !== undefined ? { maxSteps } : {}),
          ...(toolOrder !== undefined ? { toolOrder } : {}),
          ...(toolSettle !== undefined ? { toolSettle } : {}),
          ...(llmRetryMaxRetries !== undefined ? { llmRetryMaxRetries } : {}),
          ...(timeoutMs !== undefined || maxOutputBytes !== undefined
            ? {
                bashLimits: {
                  ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                  ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
                },
              }
            : {}),
          webSearch,
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

      const faceCheckAuth = (r: IncomingMessage) => {
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
                  injectBootIntoHtml(html, boot),
              },
            }
          : {}),
        tryHandleExtraApi: (req, res) =>
          tryHandleFaceHttp(req, res, faceRuntime, {
            apiKey: effectiveHostApiKey(faceRuntime),
            checkAuth: faceCheckAuth,
          }),
        attachExtras: (server) =>
          attachFaceUpgrades(server, faceRuntime, {
            apiKey: effectiveHostApiKey(faceRuntime),
            checkAuth: faceCheckAuth,
          }),
      });

      const addr = await http.listen();
      log?.info(`listening ${config.runtime.host}:${addr.port}`);
      let status: HostInstance["status"] = "running";

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
          status = "stopped";
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
