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
import { createHttpServer, type HarnessHttpServer, injectBootIntoHtml, loadBootManifestFromWebDist, mergeWebBootManifests, resolveWebBootManifest } from "@xrkseek/server-http";
import {
  attachFaceUpgrades,
  createFaceRuntime,
  effectiveHostApiKey,
  isLoopbackAddress,
  tryHandleFaceHttp,
  type FaceApprovalBroker,
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
import { loadMcpToolPlugins, parseMcpServersEnv } from "./mcp-wire.js";

export { createHostAgentCache, HOST_PLUGINS_KEY } from "./agent-cache.js";
export type { AgentResolveOpts, HostAgentCache } from "./agent-cache.js";
export {
  loadMcpToolPlugins,
  parseMcpServersEnv,
  type McpServerSpec,
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

      const mcpSpecs =
        config.runtime.mcpServers ??
        parseMcpServersEnv(process.env.XRK_MCP_SERVERS);
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
      const lastDrainResult = new Map<string, AgentRunResult>();
      const attachments = createMemoryAttachmentStore();

      const ensureSession = (sid?: string) => newSession(store, sid).id;

      const faceBox: { approvals?: FaceApprovalBroker } = {};

      const lineage: { parentOf: (sessionId: string) => string | undefined } = {
        parentOf: () => undefined,
      };

      const resolveAgent = async (sessionId: string) => {
        // Cache composition binding only — never treat AgentHandle as transcript source (ADR-0003).
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
            });
            if (faceBox.approvals) {
              agent.setApprovalHandler(faceBox.approvals.handlerFor(sessionId));
            }
            return agent;
          },
          { parentSessionId: lineage.parentOf(sessionId) },
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
      const boot = mergeWebBootManifests(
        resolveWebBootManifest(config.runtime.webDist),
        webOverlay ? loadBootManifestFromWebDist(webOverlay) : undefined,
      );
      const faceRuntime = createFaceRuntime({
        store,
        resolveAgent,
        workspaceRoot: config.runtime.workspaceRoot,
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
        plugins: loader.list(),
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
        drain: {
          wake: (sessionId) => drain.wake(sessionId),
          cancel: (sessionId) => drain.cancel(sessionId),
          isActive: (sessionId) => drain.isActive(sessionId),
        },
      });
      faceBox.approvals = faceRuntime.approvals;
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
        loadedPluginIds,
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
