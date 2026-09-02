import type { AttachmentStore } from "@xrkseek/attachment";
import {
  forkSession,
  listPendingAdmits,
  newSession,
  type PersistentSessionStore,
  type SessionStore,
} from "@xrkseek/core-session";
import type { AgentHandle } from "@xrkseek/core-agent";
import type { ToolRegistry } from "@xrkseek/core-tools";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "@xrkseek/llm-registry";
import type { PolicyEngine } from "@xrkseek/policy";
import type { ShellService } from "@xrkseek/exec-shell";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  flattenText,
  isHumanUserMessageSource,
  newUserMessageId,
} from "@xrkseek/protocol";
import { createFaceBus, type FaceBus } from "./bus.js";
import type { FaceDrain, FaceRuntime } from "./context.js";
import { createFaceSeqClock, type FaceSeqClock } from "./seq.js";
import {
  createFaceListProjectionCache,
  createFaceProjectionRegistry,
  FaceTitleController,
  installDefaultFaceProjections,
  type FaceListProjectionCache,
  type FaceProjectionRegistry,
} from "./projections/index.js";
import { FaceInboxWireMaps, FaceToolArgMaps, toMuxSessionEvent } from "./adapt/index.js";
import {
  formatJobCompletionNotice,
  isSettledJobStatus,
  jobViews,
  JOB_COMPLETION_MAX_WAKES,
  type FaceJobsSource,
  type JobView,
} from "./adapt/job-view.js";
import { formatSubagentCompletionNotice } from "./adapt/subagent-notice.js";
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
  hydrateFaceHostSettings,
  type FaceHostPublicSettings,
  type FaceCordisHostBridge,
  type FaceMcpServerDraft,
  type FaceUiSettings,
} from "./settings-credentials.js";
import { hydrateFaceSettingsDocument } from "./settings-document.js";
import { FaceApprovalBroker, approvalRequestedFrame, approvalResolvedFrame } from "./approvals.js";
import {
  FaceQuestionBroker,
  bindAskUserTool,
  bindExitPlanModeTool,
  formatQuestionAnswer,
  questionRequestedFrame,
  questionResolvedFrame,
} from "./questions.js";
import { FaceWorkspaceRegistry } from "./workspace-registry.js";
import { hydrateWorkspaceRegistry } from "./workspace-store.js";
import { FaceSubagentRegistry } from "./subagent-registry.js";
import { FaceMessageFeedbackStore } from "./message-feedback.js";
import { FaceGoalStore } from "./goal-store.js";
import { FaceWireIdMaps } from "./adapt/wire-ids.js";
import { configureCostMeterHome } from "./cost-meter-store.js";
import {
  applyCostMeterUsageSample,
  usageSampleFromMessage,
} from "./cost-meter-record.js";
export interface CreateFaceRuntimeOptions {
  readonly store: SessionStore;
  readonly resolveAgent: (sessionId: string) => Promise<AgentHandle>;
  readonly drain: FaceDrain;
  readonly workspaceRoot: string;
  /** Override harness home for settings/creds (default `~/.xrk`). Workspace inject stays `{workspaceRoot}/.xrk`. */
  readonly productDir?: string;
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
  /**
   * Host live-applies Face `mcp.servers` when MCP is sourced from
   * host-settings.json (env empty).
   */
  readonly syncMcpServers?: (
    servers: readonly FaceMcpServerDraft[],
  ) => Promise<{
    readonly failures: readonly {
      readonly serverName: string;
      readonly message: string;
    }[];
  }>;
  /** Product-shell boot entries listed in inventory. */
  readonly webPlugins?: readonly FaceWebPlugin[];
  readonly invalidateAgent?: (sessionId: string) => void | Promise<void>;
  /** Public host runtime snapshot for settings.get (no secrets). */
  readonly hostPublic?: FaceHostPublicSettings;
  /** Cordis panel `runHostHalf` → dsh-compat `host.mjs` apply. */
  readonly cordisHostBridge?: FaceCordisHostBridge;
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
  readonly openNativePath?: (target: string) => Promise<void>;
  /** Inject native folder chooser (tests). Default `pickNativeDirectory`. */
  readonly pickNativeDirectory?: (signal: AbortSignal) => Promise<string | null>;
  /** Durable image store (default none → image RPCs unavailable). */
  readonly attachments?: AttachmentStore;
  /** Standing tool registry (preset layer) when no live agent is remembered. */
  readonly tools?: ToolRegistry;
  /** Standing / unowned jobs (DSH `ctx.jobs` without an owner). */
  readonly jobs?: FaceJobsSource;
  /**
   * When true, `/permission` refuses sandbox mode changes while PTY sessions
   * are open or spawning (CV DSH terminal-bash sandbox fence).
   */
  readonly hasPtyActivity?: () => boolean;
  /** Host input modalities; default text-only. */
  readonly inputModalities?: readonly ("text" | "image")[];
  /** Host persists `/auto-review` slash to dsh-compat store (DSH panel HTTP). */
  readonly autoReviewSlashPersist?: (args: string) => void;
  /** Optional JSON sidecar for parent→child links (sessions directory). */
  readonly subagentPersistPath?: string;
  /** Optional JSON sidecar for Face goals (sessions directory). */
  readonly goalPersistPath?: string;
  /**
   * Cold `session.list` projection column (`title` · `sessionListMetadata`).
   * Typical path: `{sessionsDir}/projection-list-cache.json`.
   */
  readonly listProjectionCachePath?: string;
  /** Shared shell job registry (harness/server preset). */
  readonly shell?: ShellService;
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

  const readEvents = (sessionId: string): readonly SessionEvent[] => {
    const persistent = store as PersistentSessionStore;
    if (typeof persistent.eventsRef === "function") {
      try {
        return persistent.eventsRef(sessionId);
      } catch {
        return store.get(sessionId).events;
      }
    }
    return store.get(sessionId).events;
  };

  const projections =
    options.projections ??
    createFaceProjectionRegistry({
      getEvents: readEvents,
    });

  if (!options.skipDefaultProjections && !options.projections) {
    installDefaultFaceProjections(projections, {
      ...(options.attachments
        ? { imageLimits: options.attachments.imageLimits }
        : {}),
    });
  }

  const listProjectionCache: FaceListProjectionCache =
    createFaceListProjectionCache(options.listProjectionCachePath);
  const rememberListProjections = (sessionId: string): void => {
    try {
      listProjectionCache.remember(sessionId, projections.checkpoint(sessionId));
    } catch {
      /* cold column is best-effort */
    }
  };

  const rpcAdmitMap = new Map<string, string>();
  const admitRpcMap = new Map<string, string>();
  const pendingUserRpc = new Map<string, string>();
  const sessionModels = new Map<
    string,
    { provider: string; model: string; reasoningEffort?: string }
  >();
  const costMeterRoutes = new Map<string, { provider: string; model: string }>();
  const sessionAgentPresets = new Map<string, string>();
  const sessionCwds = new Map<string, string>();
  const workspaces = new FaceWorkspaceRegistry(options.workspaceRoot);
  const subagents = new FaceSubagentRegistry(options.subagentPersistPath);
  const messageFeedback = new FaceMessageFeedbackStore();
  const goals = new FaceGoalStore(options.goalPersistPath);
  const wireIds = new FaceWireIdMaps();
  const toolArgMaps = new FaceToolArgMaps();
  if (
    typeof (store as PersistentSessionStore).bindSessionEviction === "function"
  ) {
    (store as PersistentSessionStore).bindSessionEviction((sessionId) => {
      rememberListProjections(sessionId);
      projections.evictSession(sessionId);
      toolArgMaps.forSession(sessionId).clear();
    });
  }
  const inboxWire = new FaceInboxWireMaps(admitRpcMap);
  const rememberedTools = new Map<string, ToolRegistry>();
  const rememberedJobs = new Map<string, NonNullable<AgentHandle["jobs"]>>();
  const jobUnsubs = new Map<string, () => void>();
  /** Job ids already notified (or already settled at bind). */
  const reportedJobIds = new Map<string, Set<string>>();
  /** Consecutive completion-wakes since the last human-promoted admit. */
  const spentWakes = new Map<string, number>();
  const noticeAdmitIds = new Set<string>();

  const hasJobsRegistry = (): boolean =>
    options.jobs !== undefined || rememberedJobs.size > 0;

  const listJobViews = (sessionId: string): JobView[] => {
    const owned = rememberedJobs.get(sessionId)?.list() ?? [];
    const unowned = options.jobs?.list() ?? [];
    return jobViews([...unowned, ...owned]);
  };

  const jobViewsFor = (sessionId: string): JobView[] | undefined => {
    if (!hasJobsRegistry()) return undefined;
    return listJobViews(sessionId);
  };

  const publishJobs = (
    sessionId: string,
    opts?: { baseline?: boolean },
  ): void => {
    if (!hasJobsRegistry()) return;
    const views = listJobViews(sessionId);
    if (opts?.baseline && views.length === 0) return;
    bus.publishMux({ type: "session/jobs", sessionId, jobs: views });
  };

  const bindAgentJobs = (
    sessionId: string,
    agent: AgentHandle,
  ): void => {
    jobUnsubs.get(sessionId)?.();
    jobUnsubs.delete(sessionId);
    if (!agent.jobs) {
      rememberedJobs.delete(sessionId);
      reportedJobIds.delete(sessionId);
      return;
    }
    rememberedJobs.set(sessionId, agent.jobs);
    const reported = new Set<string>();
    for (const job of agent.jobs.list()) {
      if (isSettledJobStatus(job.status)) reported.add(job.id);
    }
    reportedJobIds.set(sessionId, reported);
    jobUnsubs.set(
      sessionId,
      agent.jobs.onJobsChanged(() => {
        publishJobs(sessionId);
        deliverOwnedJobCompletions(sessionId, agent);
      }),
    );
  };

  /**
   * DSH tool-jobs `onJobDone`: idle + wake budget → steer + wake;
   * busy → steer (+ wake, promotes at next tool-step / turn boundary);
   * idle over budget → steer only (waits for other wake).
   *
   * Steer matches Codex inject-into-running-turn: background jobs exist so the
   * agent can read results without waiting in the user FIFO queue.
   */
  const deliverOwnedJobCompletions = (
    sessionId: string,
    agent: AgentHandle,
  ): void => {
    if (!agent.jobs) return;
    const reported = reportedJobIds.get(sessionId) ?? new Set<string>();
    for (const job of agent.jobs.list()) {
      if (
        !isSettledJobStatus(job.status) ||
        reported.has(job.id) ||
        job.reported === true
      ) {
        continue;
      }
      reported.add(job.id);
      const idle = !agent.isBusy();
      const spent = spentWakes.get(sessionId) ?? 0;
      const followup = idle && spent < JOB_COMPLETION_MAX_WAKES;
      if (followup) spentWakes.set(sessionId, spent + 1);
      const receipt = agent.admit(
        formatJobCompletionNotice(job, job.outputLimitBytes),
        {
          delivery: "steer",
        },
      );
      noticeAdmitIds.add(receipt.admitId);
      if (followup || !idle) options.drain.wake(sessionId);
    }
    reportedJobIds.set(sessionId, reported);
  };

  /** Child session ids already notified for the current idle stretch. */
  const reportedSubagentIdle = new Set<string>();

  /**
   * Mirror job completions: when a continuable child drain goes idle, admit a
   * steer notice on the parent (+ wake under the same budget).
   *
   * Steer (not queue) matches Codex `inject_fragment_without_turn`: parent
   * must see child results at the next tool-step / turn boundary while still
   * running — subagent spawn is for fast information, not user-style FIFO.
   */
  const deliverOwnedSubagentCompletion = (childSessionId: string): void => {
    const link = subagents.getByChild(childSessionId);
    if (!link || link.mode !== "continuable") return;
    if (reportedSubagentIdle.has(childSessionId)) return;
    reportedSubagentIdle.add(childSessionId);
    const parentId = link.parentSessionId;
    void resolveAgent(parentId).then((parent) => {
      const idle = !parent.isBusy();
      const spent = spentWakes.get(parentId) ?? 0;
      const followup = idle && spent < JOB_COMPLETION_MAX_WAKES;
      if (followup) spentWakes.set(parentId, spent + 1);
      const events = store.get(childSessionId).events;
      const receipt = parent.admit(
        formatSubagentCompletionNotice(link, events),
        { delivery: "steer" },
      );
      noticeAdmitIds.add(receipt.admitId);
      if (followup || !idle) options.drain.wake(parentId);
    });
  };

  const getTool = (sessionId: string, name: string) => {
    const fromAgent = rememberedTools.get(sessionId)?.get(name);
    if (fromAgent) return fromAgent;
    const fromStanding = options.tools?.get(name);
    if (fromStanding) return fromStanding;
    for (const plugin of options.plugins ?? []) {
      const hit = plugin.tools?.find((t) => t.name === name);
      if (hit) return hit;
    }
    return undefined;
  };

  const questions = new FaceQuestionBroker({
    onRequested(item) {
      bus.publishMux(questionRequestedFrame(item), item.rpcId);
    },
    onResolved(sessionId, questionRpcId, outcome) {
      bus.publishMux(questionResolvedFrame(sessionId, questionRpcId, outcome));
    },
  });

  const resolveAgent = async (sessionId: string) => {
    const agent = await options.resolveAgent(sessionId);
    if (agent.tools) {
      rememberedTools.set(sessionId, agent.tools);
      bindAskUserTool(agent.tools, (qs, signal) =>
        questions.ask(sessionId, qs, signal).then(formatQuestionAnswer),
      );
      bindExitPlanModeTool(agent.tools, store, sessionId, (qs, signal) =>
        questions.ask(sessionId, qs, signal),
      );
    }
    bindAgentJobs(sessionId, agent);
    return agent;
  };

  const invalidateAgent = options.invalidateAgent
    ? async (sessionId: string) => {
        rememberedTools.delete(sessionId);
        jobUnsubs.get(sessionId)?.();
        jobUnsubs.delete(sessionId);
        rememberedJobs.delete(sessionId);
        reportedJobIds.delete(sessionId);
        spentWakes.delete(sessionId);
        reportedSubagentIdle.delete(sessionId);
        await options.invalidateAgent!(sessionId);
      }
    : undefined;

  if (options.jobs) {
    options.jobs.onJobsChanged(() => {
      for (const sessionId of store.list()) {
        publishJobs(sessionId);
      }
    });
  }

  const titleBox: { controller: FaceTitleController | undefined } = {
    controller: undefined,
  };

  const runtimeBox: { current: FaceRuntime | undefined } = {
    current: undefined,
  };

  /** While true, skip title fallback (event replay / fork must not invent log rows). */
  let replayingLog = false;

  configureCostMeterHome(options.productDir);

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

    // DSH: every UserMessage has a stable MessageId. Face conversation keys
    // rows by wire data.id (= messageId); bare turnId collides when durable
    // injects share a turn with the human prompt.
    if (
      next.type === "user/message" &&
      !replayingLog &&
      next.messageId === undefined
    ) {
      next = { ...next, messageId: newUserMessageId() };
    }

    const frozen = originalAppend(id, next);
    const eventSeq = seq.next(id);
    toolArgMaps.remember(id, frozen);
    bus.publishMux(
      toMuxSessionEvent(id, frozen, eventSeq, {
        sessionId: id,
        ids: wireIds,
        inbox: inboxWire.forSession(id),
        toolArgs: toolArgMaps.forSession(id),
        getTool: (name) => getTool(id, name),
      }),
    );
    projections.drive(id, frozen, eventSeq);
    if (!replayingLog) {
      if (frozen.type === "request/header") {
        costMeterRoutes.set(id, {
          provider: frozen.header.config.provider,
          model: frozen.header.config.model,
        });
      }
      if (frozen.type === "assistant/message" && frozen.usage) {
        const route =
          costMeterRoutes.get(id) ??
          sessionModels.get(id) ?? { provider: "deepseek", model: "unknown" };
        const sample = usageSampleFromMessage(
          id,
          frozen,
          route.provider,
          route.model,
        );
        if (sample) applyCostMeterUsageSample(sample);
      }
    }
    if (
      frozen.type === "user/message" &&
      !replayingLog &&
      isHumanUserMessageSource(frozen.source)
    ) {
      titleBox.controller?.maybeFallbackFromUserMessage(
        id,
        eventSeq,
        flattenText(frozen.content),
      );
    }
    if (frozen.type === "prompt/promoted") {
      if (noticeAdmitIds.has(frozen.admitId)) {
        noticeAdmitIds.delete(frozen.admitId);
      } else {
        spentWakes.delete(id);
      }
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
    resolveAgent,
    drain: options.drain,
    registry: options.registry ?? createProviderRegistry(),
    workspaceRoot: options.workspaceRoot,
    ...(options.productDir !== undefined
      ? { productDir: options.productDir }
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
    ...(options.cordisHostBridge !== undefined
      ? { cordisHostBridge: options.cordisHostBridge }
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
    ...(options.pickNativeDirectory !== undefined
      ? { pickNativeDirectory: options.pickNativeDirectory }
      : {}),
    bus,
    seq,
    projections,
    listProjectionCache,
    titles,
    approvals,
    questions,
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
    ...(options.syncMcpServers !== undefined
      ? { syncMcpServers: options.syncMcpServers }
      : {}),
    ...(options.autoReviewSlashPersist !== undefined
      ? { autoReviewSlashPersist: options.autoReviewSlashPersist }
      : {}),
    getTool,
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
    jobViewsFor,
    publishJobs,
    watchSession(sessionId) {
      publishJobs(sessionId, { baseline: true });
    },
    forkSession(sourceId, boundaryIndex, childId) {
      replayingLog = true;
      try {
        return forkSession(store, sourceId, boundaryIndex, childId);
      } finally {
        replayingLog = false;
      }
    },
    onSessionDrainStatus(sessionId, running) {
      if (running) {
        reportedSubagentIdle.delete(sessionId);
        return;
      }
      deliverOwnedSubagentCompletion(sessionId);
    },
    ...(options.defaultAgentPreset
      ? { defaultAgentPreset: options.defaultAgentPreset }
      : {}),
    ...(invalidateAgent ? { invalidateAgent } : {}),
    ...(options.hasPtyActivity
      ? { hasPtyActivity: options.hasPtyActivity }
      : {}),
    ...(options.shell ? { shell: options.shell } : {}),
  };
  runtimeBox.current = runtime;
  goals.bind(runtime);
  hydrateFaceSettingsDocument(runtime);
  hydrateFaceHostSettings(runtime);
  hydrateWorkspaceRegistry(runtime, workspaces);
  return runtime;
}
