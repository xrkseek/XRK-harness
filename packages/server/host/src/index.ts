import type { AgentHandle, AgentRunResult } from "@xrkseek/core-agent";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import {
  createJsonlSessionStore,
  createMemorySessionStore,
  createSessionDrainHub,
  newSession,
  type SessionDrainHub,
  type SessionStore,
} from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { createPolicyEngineFromFile } from "@xrkseek/policy";
import type { HostConfig } from "@xrkseek/server-config";
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
  tryHandleFaceHttp,
  type FaceApprovalBroker,
  type FaceQuestionBroker,
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
import {
  loadMcpToolPlugins,
  mcpDraftsToSpecs,
  parseMcpServersEnv,
  readMcpServersFromHostSettings,
  reconcileMcpToolPlugins,
  type McpServerDraft,
} from "./mcp-wire.js";
import { createStandingToolRegistry } from "./standing-tools.js";
import { createDefaultPtyAccess } from "@xrkseek/exec-pty";
import { createLocalShell } from "@xrkseek/exec-shell";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";

export { createHostAgentCache, HOST_PLUGINS_KEY } from "./agent-cache.js";
export { createStandingToolRegistry } from "./standing-tools.js";
export type { AgentResolveOpts, HostAgentCache } from "./agent-cache.js";
export {
  loadMcpToolPlugins,
  mcpDraftsToSpecs,
  mcpFingerprint,
  parseMcpServersEnv,
  readMcpServersFromHostSettings,
  reconcileMcpToolPlugins,
  type McpRegisteredPlugin,
  type McpServerDraft,
  type McpServerSpec,
  type ReconcileMcpResult,
} from "./mcp-wire.js";

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
function configuredMcpSpecs(config: HostConfig) {
  return (
    config.runtime.mcpServers ??
    parseMcpServersEnv(process.env.XRK_MCP_SERVERS)
  );
}

/** Env/config win; empty → Face dump `{workspace}/.xrk/host-settings.json`. */
function resolveMcpSpecs(config: HostConfig) {
  const configured = configuredMcpSpecs(config);
  if (configured.length > 0) return configured;
  return readMcpServersFromHostSettings(
    path.join(config.runtime.workspaceRoot, ".xrk", "host-settings.json"),
  );
}

export type AgentImageResolver = (
  attachmentId: string,
) => Promise<{ readonly mediaType: string; readonly data: Uint8Array }>;

export type AgentFactory = (input: {
  sessionId: string;
  store: SessionStore;
  workspaceRoot: string;
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
}) => Promise<AgentHandle>;

/** Host-side drain control (admit wake / resume join). */
export interface SessionDrainControl {
  run(sessionId: string): Promise<AgentRunResult | undefined>;
  wake(sessionId: string): void;
  cancel(sessionId: string): Promise<void>;
  isActive(sessionId: string): boolean;
}

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
  };
  stop(): Promise<void>;
}

export interface HostManager {
  spawn(config: HostConfig, factory: AgentFactory): Promise<HostInstance>;
  get(id: string): HostInstance | undefined;
  list(): readonly HostInstance[];
  stop(id: string): Promise<void>;
  stopAll(): Promise<void>;
}

export function createHostManager(): HostManager {
  const instances = new Map<string, HostInstance>();
  let seq = 0;

  return {
    async spawn(config, factory) {
      const id = `host_${++seq}`;
      const sessionsDir = config.runtime.sessionsDir?.trim();
      const store: SessionStore = sessionsDir
        ? createJsonlSessionStore(sessionsDir)
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
      let invalidateAgents: () => Promise<void> = async () => {};
      if (mcpSpecs.length > 0) {
        const mcpPlugins = await loadMcpToolPlugins({
          specs: mcpSpecs,
          ...(policy ? { policy } : {}),
          allowConnect: Boolean(config.runtime.mcpAllowConnect),
          onToolsChanged: () => invalidateAgents(),
        });
        for (const p of mcpPlugins) {
          if (loader.list().some((x) => x.id === p.id)) continue;
          loader.register(p);
          loadedPluginIds = [...loadedPluginIds, p.id];
        }
      }

      const agentCache = createHostAgentCache(loader.list(), { hostId: id });
      invalidateAgents = () => agentCache.invalidateAll();
      /** Mutable Face inventory — Host splices after MCP reconcile. */
      const facePlugins: RegisteredPlugin[] = [...loader.list()];
      const refreshFacePlugins = () => {
        facePlugins.splice(0, facePlugins.length, ...loader.list());
      };
      const lastDrainResult = new Map<string, AgentRunResult>();
      const attachments = createMemoryAttachmentStore();

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

      const lineage: { parentOf: (sessionId: string) => string | undefined } = {
        parentOf: () => undefined,
      };

      const resolveAgent = async (sessionId: string) => {
        // Cache composition binding only — never treat AgentHandle as transcript source (ADR-0003).
        const parentSessionId = lineage.parentOf(sessionId);
        return agentCache.resolve(
          sessionId,
          async () => {
            const agent = await factory({
              sessionId,
              store,
              workspaceRoot: config.runtime.workspaceRoot,
              plugins: loader.list(),
              resolveImage: async (attachmentId) => {
                const stored = await attachments.readImage(attachmentId);
                return {
                  mediaType: stored.ref.mediaType,
                  data: stored.data,
                };
              },
              ...(sharedPty ? { ptyService: sharedPty.service } : {}),
              ...(sharedShell ? { shellJobs: sharedShell } : {}),
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
        },
      });

      const drain: SessionDrainControl = {
        async run(sessionId) {
          await hub.run(sessionId);
          return lastDrainResult.get(sessionId);
        },
        wake(sessionId) {
          hub.wake(sessionId);
        },
        cancel(sessionId) {
          return hub.cancel(sessionId);
        },
        isActive(sessionId) {
          return hub.isActive(sessionId);
        },
      };

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
        tools: createStandingToolRegistry({
          workspaceRoot: config.runtime.workspaceRoot,
          preset: config.runtime.preset,
        }),
        version: "0.0.0",
        defaultAgentPreset: config.runtime.preset,
        registry: createProviderRegistry(),
        attachments,
        // Face admits images; adapter `inputModalities` still gates the LLM call.
        // Official DeepSeek brand stays text-only at the adapter.
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
              syncMcpServers: async (servers: readonly McpServerDraft[]) => {
                await reconcileMcpToolPlugins({
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
                  allowConnect: Boolean(config.runtime.mcpAllowConnect),
                  onToolsChanged: () => invalidateAgents(),
                });
                refreshFacePlugins();
                await invalidateAgents();
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
      faceBox.approvals = faceRuntime.approvals;
      faceBox.questions = faceRuntime.questions;
      lineage.parentOf = (sessionId) =>
        faceRuntime.subagents.getByChild(sessionId)?.parentSessionId;

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
