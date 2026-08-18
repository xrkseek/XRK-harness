import type { AttachmentStore } from "@xrkseek/attachment";
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
import { flattenText } from "@xrkseek/protocol";
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
import type {
  FaceProcessPlugin,
  FaceWebPlugin,
} from "./plugin-inventory.js";
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
import { FaceApprovalBroker, approvalRequestedFrame, approvalResolvedFrame } from "./approvals.js";
import { FaceWorkspaceRegistry } from "./workspace-registry.js";
import { FaceSubagentRegistry } from "./subagent-registry.js";
import { FaceMessageFeedbackStore } from "./message-feedback.js";
import { FaceGoalStore } from "./goal-store.js";
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
  /** Process plugins for `pluginInventory/list` + `commands/*`. */
  readonly plugins?: readonly FaceProcessPlugin[];
  /** Product-shell boot entries listed in inventory. */
  readonly webPlugins?: readonly FaceWebPlugin[];
  readonly invalidateAgent?: (sessionId: string) => void | Promise<void>;
  /** Public host runtime snapshot for settings.get (no secrets). */
  readonly hostPublic?: FaceHostPublicSettings;
  /** Initial Host API key from env (vault may override). */
  readonly bootstrapApiKey?: string;
  readonly uiSettings?: FaceUiSettings;
  readonly policy?: PolicyEngine;
  /**
   * Host-resolved settings document (e.g. `XRK_POLICY_FILE`).
   * `settings.openDocument` never takes a browser path.
   */
  readonly settingsDocumentPath?: string;
  /** Inject native opener (tests). Default `openNativePath`. */
  openNativePath?(target: string): Promise<void>;
  /** Durable image store (default none → image RPCs unavailable). */
  readonly attachments?: AttachmentStore;
  /** Host input modalities; default text-only. */
  readonly inputModalities?: readonly ("text" | "image")[];
  /** Optional JSON sidecar for parent→child links (JSONL session dir). */
  readonly subagentPersistPath?: string;
  /** Optional JSON sidecar for Face goals (JSONL session dir). */
  readonly goalPersistPath?: string;
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
  const subagents = new FaceSubagentRegistry(options.subagentPersistPath);
  const messageFeedback = new FaceMessageFeedbackStore();
  const goals = new FaceGoalStore(options.goalPersistPath);
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
        flattenText(frozen.content),
      );
    }
    if (
      frozen.type === "prompt/admitted" ||
      frozen.type === "prompt/promoted" ||
      frozen.type === "prompt/withdrawn"
    ) {
      runtimeBox.current?.publishQueue(id);
    }
    if (frozen.type === "turn/end") {
      runtimeBox.current?.goals.onTurnEnd(id);
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

  const approvals = new FaceApprovalBroker(store, {
    onRequested(item) {
      bus.publishMux(approvalRequestedFrame(item), item.rpcId);
    },
    onResolved(sessionId, approvalId, outcome) {
      bus.publishMux(approvalResolvedFrame(sessionId, approvalId, outcome));
    },
  });

  const runtime: FaceRuntime = {
    store,
    ...(options.attachments !== undefined
      ? { attachments: options.attachments }
      : {}),
    ...(options.inputModalities !== undefined
      ? { inputModalities: options.inputModalities }
      : {}),
    ensureSession(id) {
      if (id) {
        if (store.has(id)) return id;
        return newSession(store, id).id;
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
    ...(options.settingsDocumentPath !== undefined
      ? { settingsDocumentPath: options.settingsDocumentPath }
      : {}),
    ...(options.openNativePath !== undefined
      ? { openNativePath: options.openNativePath }
      : {}),
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
    subagents,
    messageFeedback,
    goals,
    wireIds,
    inboxWire,
    loadSlashRecipes,
    ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
    ...(options.webPlugins !== undefined
      ? { webPlugins: options.webPlugins }
      : {}),
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
      for (const item of approvals.listPending(sessionId)) {
        bus.publishMux(approvalRequestedFrame(item), item.rpcId);
      }
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
  goals.bind(runtime);
  return runtime;
}
