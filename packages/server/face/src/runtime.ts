import {
  forkSession,
  listPendingAdmits,
  newSession,
  type SessionStore,
} from "@xrkseek/core-session";
import type { AgentHandle } from "@xrkseek/core-agent";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "@xrkseek/llm-registry";
import type { PolicyEngine } from "@xrkseek/policy";
import type { SessionEvent } from "@xrkseek/protocol";
import { createFaceBus, type FaceBus } from "./bus.js";
import type { FaceDrain, FaceRuntime } from "./context.js";
import { createFaceSeqClock, type FaceSeqClock } from "./seq.js";
import {
  createFaceProjectionRegistry,
  FaceTitleController,
  installDefaultFaceProjections,
  type FaceProjectionRegistry,
} from "./projections/index.js";
import { FaceInboxWireMaps, toMuxSessionEvent } from "./adapt/index.js";
import { toQueueItems } from "./queue.js";
import {
  defaultRecipesLoader,
  type SlashRecipesLoader,
} from "./slash.js";
import {
  FaceCredentialVault,
  FaceSettingsNamespaces,
  defaultUiSettings,
  type FaceHostPublicSettings,
  type FaceUiSettings,
} from "./settings-credentials.js";
import { FaceApprovalBroker } from "./approvals.js";
import { FaceWorkspaceRegistry } from "./workspace-registry.js";
import { FaceWireIdMaps } from "./adapt/wire-ids.js";
export interface CreateFaceRuntimeOptions {
  readonly store: SessionStore;
  readonly resolveAgent: (sessionId: string) => Promise<AgentHandle>;
  readonly drain: FaceDrain;
  readonly workspaceRoot: string;
  /** Override product inject dir (default `{workspaceRoot}/.xrk`). */
  readonly productDir?: string;
  /** Named templates for Face `workspace.syncSeeds({ template })`. */
  readonly seedTemplateDirs?: Readonly<Record<string, string>>;
  readonly version?: string;
  readonly defaultAgentPreset?: string;
  readonly registry?: ProviderRegistry;
  readonly bus?: FaceBus;
  readonly seq?: FaceSeqClock;
  readonly projections?: FaceProjectionRegistry;
  readonly skipDefaultProjections?: boolean;
  readonly loadSlashRecipes?: SlashRecipesLoader;
  readonly invalidateAgent?: (sessionId: string) => void | Promise<void>;
  /** Public host runtime snapshot for settings.get (no secrets). */
  readonly hostPublic?: FaceHostPublicSettings;
  /** Initial Host API key from env (vault may override). */
  readonly bootstrapApiKey?: string;
  readonly uiSettings?: FaceUiSettings;
  /** Optional policy (XRK_POLICY_FILE / host) for provider.use. */
  readonly policy?: PolicyEngine;
}

/**
 * Builds Face runtime and patches `store.append` in-place so REST + Face share
 * one log; mux receives adapted session/event (+ tool view) and projections.
 */
export function createFaceRuntime(options: CreateFaceRuntimeOptions): FaceRuntime {
  const bus = options.bus ?? createFaceBus();
  const seq = options.seq ?? createFaceSeqClock();
  const store = options.store;
  const originalAppend = store.append.bind(store);

  const projections =
    options.projections ??
    createFaceProjectionRegistry({
      getEvents: (sessionId) => store.get(sessionId).events,
    });

  if (!options.skipDefaultProjections && !options.projections) {
    installDefaultFaceProjections(projections);
  }

  const rpcAdmitMap = new Map<string, string>();
  const admitRpcMap = new Map<string, string>();
  const pendingUserRpc = new Map<string, string>();
  const sessionModels = new Map<string, { provider: string; model: string }>();
  const sessionAgentPresets = new Map<string, string>();
  const sessionCwds = new Map<string, string>();
  const workspaces = new FaceWorkspaceRegistry(options.workspaceRoot);
  const wireIds = new FaceWireIdMaps();
  const inboxWire = new FaceInboxWireMaps(admitRpcMap);

  const titleBox: { controller: FaceTitleController | undefined } = {
    controller: undefined,
  };

  const runtimeBox: { current: FaceRuntime | undefined } = {
    current: undefined,
  };

  /** While true, skip title fallback (event replay / fork must not invent log rows). */
  let replayingLog = false;

  const appendPatched = (
    id: string,
    event: Parameters<typeof originalAppend>[1],
  ) => {
    let next: SessionEvent = event;

    if (next.type === "prompt/promoted") {
      const rpc = admitRpcMap.get(next.admitId);
      if (rpc) pendingUserRpc.set(id, rpc);
    }

    if (next.type === "user/message" && next.rpcId === undefined) {
      const rpc = pendingUserRpc.get(id);
      if (rpc) {
        next = { ...next, rpcId: rpc };
        pendingUserRpc.delete(id);
      }
    }

    const frozen = originalAppend(id, next);
    const eventSeq = seq.next(id);
    bus.publishMux(
      toMuxSessionEvent(
        id,
        frozen,
        eventSeq,
        wireIds,
        inboxWire.forSession(id),
      ),
    );
    projections.drive(id, frozen, eventSeq);
    if (frozen.type === "user/message" && !replayingLog) {
      titleBox.controller?.maybeFallbackFromUserMessage(
        id,
        eventSeq,
        frozen.content,
      );
    }
    if (
      frozen.type === "prompt/admitted" ||
      frozen.type === "prompt/promoted" ||
      frozen.type === "prompt/withdrawn"
    ) {
      runtimeBox.current?.publishQueue(id);
    }
    return frozen;
  };

  store.append = appendPatched;

  const titles = new FaceTitleController({
    append: (sessionId, event) => appendPatched(sessionId, event),
    getEvents: (sessionId) => store.get(sessionId).events,
    projections,
  });
  titleBox.controller = titles;

  projections.onChanged((sessionId, key, value, changeSeq) => {
    bus.publishMux({
      type: "session/projection",
      sessionId,
      key,
      value,
      seq: changeSeq,
    });
  });

  const loadSlashRecipes =
    options.loadSlashRecipes ?? defaultRecipesLoader(options.workspaceRoot);

  const approvals = new FaceApprovalBroker(store, (sessionId) => {
    runtimeBox.current?.publishApprovals(sessionId);
  });

  const runtime: FaceRuntime = {
    store,
    ensureSession(id) {
      if (id) {
        try {
          store.get(id);
          return id;
        } catch {
          return newSession(store, id).id;
        }
      }
      return newSession(store).id;
    },
    resolveAgent: options.resolveAgent,
    drain: options.drain,
    registry: options.registry ?? createProviderRegistry(),
    workspaceRoot: options.workspaceRoot,
    ...(options.productDir !== undefined
      ? { productDir: options.productDir }
      : {}),
    ...(options.seedTemplateDirs !== undefined
      ? { seedTemplateDirs: options.seedTemplateDirs }
      : {}),
    version: options.version ?? "0.0.0",
    uiSettings: options.uiSettings
      ? { ...options.uiSettings }
      : defaultUiSettings(),
    credentials: new FaceCredentialVault(),
    settingsNamespaces: new FaceSettingsNamespaces(),
    ...(options.hostPublic !== undefined
      ? { hostPublic: options.hostPublic }
      : {}),
    ...(options.bootstrapApiKey !== undefined
      ? { bootstrapApiKey: options.bootstrapApiKey }
      : {}),
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
    bus,
    seq,
    projections,
    titles,
    approvals,
    rpcAdmitMap,
    admitRpcMap,
    pendingUserRpc,
    sessionModels,
    sessionAgentPresets,
    sessionCwds,
    workspaces,
    wireIds,
    inboxWire,
    loadSlashRecipes,
    publishQueue(sessionId) {
      const pending = listPendingAdmits(
        store.get(sessionId).events,
        sessionId,
      );
      bus.publishMux({
        type: "session/queue",
        sessionId,
        items: toQueueItems(pending, admitRpcMap),
      });
    },
    publishApprovals(sessionId) {
      bus.publishMux({
        type: "session/approvals",
        sessionId,
        items: [...approvals.listPending(sessionId)],
      });
    },
    watchSession(_sessionId) {
      /* append fan-out is global */
    },
    forkSession(sourceId, boundaryIndex, childId) {
      replayingLog = true;
      try {
        return forkSession(store, sourceId, boundaryIndex, childId);
      } finally {
        replayingLog = false;
      }
    },
    ...(options.defaultAgentPreset
      ? { defaultAgentPreset: options.defaultAgentPreset }
      : {}),
    ...(options.invalidateAgent
      ? { invalidateAgent: options.invalidateAgent }
      : {}),
  };
  runtimeBox.current = runtime;
  return runtime;
}
