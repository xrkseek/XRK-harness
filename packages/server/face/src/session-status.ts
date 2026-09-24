/**
 * Shared session Status snapshot — Hermes-style single field set for `/status`
 * slash text and the Overview Status tab (`session.status` Face RPC).
 */
import {
  listPendingAdmits,
  readSessionEvents,
  sessionEventCount,
} from "@xrkseek/core-session";
import { foldPlanMode } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { permissionSelectFromEvents } from "./permissions.js";
import { resolveSessionModelSelection } from "./model-catalog.js";
import { resolveSessionCwd } from "./session-cwd.js";
import {
  buildFaceChannelDiscover,
  resolveImGatewayWired,
} from "./process-channels.js";
import type { JobView } from "./adapt/job-view.js";
import type { CostUsageProjection } from "./projections/units/cost-usage.js";
import type {
  ContextTimelineCompactReason,
  ContextTimelineEvent,
  ContextTimelineProjection,
} from "./projections/units/context-timeline.js";
import type { AgentTeamTask } from "./agent-team-tasks.js";
import { costMeterGetState } from "./cost-meter-store.js";
import { resolveSubagentQuota } from "./subagent-tools.js";
import { isChildSessionActive } from "./external-agent-runtime.js";

export interface SessionStatusJobRow {
  readonly id: string;
  readonly status: string;
  readonly label?: string;
}

export interface SessionStatusSubagentLive {
  readonly id: string;
  readonly label?: string;
  readonly activity: "running" | "inactive";
  readonly mode: string;
  readonly liveText?: string;
  readonly liveTool?: string;
  /** Child inbox admits waiting as queue (not yet drained). */
  readonly queued?: number;
  /** Child inbox admits waiting as steer. */
  readonly steering?: number;
}

/** Depth / concurrency caps for Status + model `analytics`. */
export interface SessionStatusSubagentQuota {
  readonly depth: number;
  readonly maxDepth: number;
  readonly active: number;
  readonly maxActive: number;
  readonly delegated: number;
  readonly slotsFree: number;
}

export interface SessionStatusGraph {
  readonly nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly role?: string;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly kind: string;
    readonly label?: string;
  }[];
}

export interface SessionStatusCostBuckets {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
  readonly cost: number;
}

/** Per-session costUsage totals + model breakdown (Face projection). */
export interface SessionStatusCost extends SessionStatusCostBuckets {
  readonly byModel: Readonly<Record<string, SessionStatusCostBuckets>>;
  readonly byProviderModel: Readonly<Record<string, SessionStatusCostBuckets>>;
}

/** One ranked row for Overview / `/status` (session or ledger). */
export interface SessionStatusCostModelRow {
  readonly key: string;
  readonly input: number;
  readonly output: number;
  readonly cost: number;
}

/**
 * Cross-session cost-meter ledger fold (today / month / total + top models).
 * Same file ledger as `costMeter/getState` · tokenledger — not a second SoT.
 */
export interface SessionStatusBilling {
  readonly todayCost: number;
  readonly monthCost: number;
  readonly totalCost: number;
  readonly todayTokens: number;
  readonly monthTokens: number;
  /** Month window, ranked by cost then tokens (max 8). */
  readonly byModel: readonly SessionStatusCostModelRow[];
  /** Month window `provider:model`, ranked (max 8). */
  readonly byProviderModel: readonly SessionStatusCostModelRow[];
}

export interface SessionStatusTimeline {
  readonly total: number;
  readonly system: number;
  readonly tools: number;
  readonly user: number;
  readonly inject: number;
  readonly assistant: number;
  readonly tool: number;
  readonly requestCount: number;
  readonly eventCount: number;
  readonly model?: string;
  readonly provider?: string;
  readonly contextWindow?: number;
  /** Distinct inject source labels (kind · form · plugin name). */
  readonly injectSources: readonly string[];
  /** Latest compaction reason when any compaction event exists. */
  readonly lastCompactReason?: ContextTimelineCompactReason;
  /** Latest shadowedTokenCount from compaction (when logged). */
  readonly lastShadowedTokens?: number;
  /** Count of prune events that cite a spill path. */
  readonly spillCount: number;
  /** Count of tool-result prune / spill boundary events. */
  readonly pruneCount: number;
}

/** Soft-budget / overflow stage chain folded from durable timeline events. */
export type SessionStatusCompactionPipeline =
  | "none"
  | "prune"
  | "summary"
  | "prune→summary";

export type SessionStatusCompactionStage = "prune" | "summary";

/**
 * Prune-first then summary observability (DSH-aligned stages on the Status
 * surface — no extra protocol events; folds existing prune + compaction rows).
 */
export interface SessionStatusCompaction {
  /** Last completed stage chain within one turn (or across latest markers). */
  readonly pipeline: SessionStatusCompactionPipeline;
  /** Ordered stages for that last pipeline (empty when `none`). */
  readonly stages: readonly SessionStatusCompactionStage[];
  readonly lastReason?: ContextTimelineCompactReason;
  readonly lastShadowedTokens?: number;
  readonly pruneCount: number;
  /** Count of `context/compaction` (summary) timeline rows. */
  readonly summaryCount: number;
  readonly spillCount: number;
  /**
   * Live latch: turn or manual `/compact` holds the agent busy bit
   * (compact and turn are mutually exclusive on the same latch).
   */
  readonly phase: "idle" | "busy";
}

/**
 * Queue vs turn mutual exclusion facts for the Overview Status column.
 * Compact shares the agent latch with the turn — queue still FIFO-accepts.
 */
export interface SessionStatusDelivery {
  readonly turnActive: boolean;
  readonly queued: number;
  readonly steering: number;
  /** True when the latch is held — `/compact` returns busy. */
  readonly compactBlockedByTurn: boolean;
  /** Admits with delivery=queue still land while the latch is held. */
  readonly queueAcceptedWhileBusy: true;
  /** Steer placement only applies while a turn is active. */
  readonly steerRequiresActiveTurn: true;
  /** One-line operator note (slash + Overview). */
  readonly note: string;
}

export interface SessionStatusChannels {
  readonly process: readonly {
    readonly pluginId: string;
    readonly channelId: string;
    readonly displayName?: string;
  }[];
  readonly im: readonly {
    readonly channelId: string;
    readonly displayName: string;
    readonly wired: string;
  }[];
  readonly note: string;
}

export interface SessionStatusTeamTask {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly revision: number;
  readonly childSessionId?: string;
  readonly role?: string;
  readonly humanOwned?: boolean;
  readonly schemaValid?: boolean;
  readonly worktreePath?: string;
  readonly worktreeBranch?: string;
  readonly worktreeId?: string;
}

/** Structured Status facts shared by slash `/status` and Overview. */
export interface SessionStatusSnapshot {
  readonly sessionId: string;
  readonly badge: string;
  readonly permission: string;
  readonly plan: "on" | "off";
  readonly theme: string;
  readonly model: { readonly provider: string; readonly model: string };
  readonly cwd: string;
  readonly events: number;
  readonly jobs: readonly SessionStatusJobRow[];
  readonly subagents: {
    readonly live: readonly SessionStatusSubagentLive[];
    readonly graph: SessionStatusGraph;
    /** Face agent-loop ∩ badge ceilings + live active count. */
    readonly quota: SessionStatusSubagentQuota;
  };
  /** Agent Teams task board (delivery · result · pause/takeover). */
  readonly teamTasks: readonly SessionStatusTeamTask[];
  readonly cost: SessionStatusCost;
  /** Host-wide ledger fold (cross-session · cross-model). */
  readonly billing: SessionStatusBilling;
  readonly timeline: SessionStatusTimeline;
  /** Prune → summary stage fold + live busy phase. */
  readonly compaction: SessionStatusCompaction;
  /** Queue / steer / turn latch mutual exclusion. */
  readonly delivery: SessionStatusDelivery;
  readonly channels: SessionStatusChannels;
}

function jobRow(view: JobView): SessionStatusJobRow {
  return {
    id: view.id,
    status: view.status,
    ...(view.label ? { label: view.label } : {}),
  };
}

function teamTaskRow(task: AgentTeamTask): SessionStatusTeamTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    revision: task.revision,
    ...(task.childSessionId ? { childSessionId: task.childSessionId } : {}),
    ...(task.role ? { role: task.role } : {}),
    ...(task.humanOwned ? { humanOwned: true } : {}),
    ...(task.schemaValid !== undefined
      ? { schemaValid: task.schemaValid }
      : {}),
    ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
    ...(task.worktreeBranch ? { worktreeBranch: task.worktreeBranch } : {}),
    ...(task.worktreeId ? { worktreeId: task.worktreeId } : {}),
  };
}

const ZERO_BUCKETS: SessionStatusCostBuckets = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  cost: 0,
};

function asBuckets(raw: unknown): SessionStatusCostBuckets {
  if (!raw || typeof raw !== "object") return ZERO_BUCKETS;
  const v = raw as Record<string, unknown>;
  const n = (k: string) =>
    typeof v[k] === "number" && Number.isFinite(v[k]) ? (v[k]) : 0;
  return {
    input: n("input"),
    output: n("output"),
    cacheRead: n("cacheRead"),
    cacheWrite: n("cacheWrite"),
    reasoning: n("reasoning"),
    cost: n("cost"),
  };
}

function asBucketMap(
  raw: unknown,
): Record<string, SessionStatusCostBuckets> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, SessionStatusCostBuckets> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim()) continue;
    out[key] = asBuckets(value);
  }
  return out;
}

function dayTokens(buckets: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}): number {
  return (
    buckets.input +
    buckets.output +
    buckets.cacheRead +
    buckets.cacheWrite +
    buckets.reasoning
  );
}

/** Rank map rows by cost, then tokens (Hermes insights-style top models). */
export function rankCostModelRows(
  map: Readonly<Record<string, SessionStatusCostBuckets>>,
  limit = 8,
): SessionStatusCostModelRow[] {
  return Object.entries(map)
    .map(([key, b]) => ({
      key,
      input: b.input,
      output: b.output,
      cost: b.cost,
      _tokens: dayTokens(b),
    }))
    .sort(
      (a, b) =>
        b.cost - a.cost ||
        b._tokens - a._tokens ||
        a.key.localeCompare(b.key),
    )
    .slice(0, Math.max(0, limit))
    .map(({ key, input, output, cost }) => ({ key, input, output, cost }));
}

function costFromProjection(
  costRaw: CostUsageProjection | undefined,
): SessionStatusCost {
  return {
    input: costRaw?.input ?? 0,
    output: costRaw?.output ?? 0,
    cacheRead: costRaw?.cacheRead ?? 0,
    cacheWrite: costRaw?.cacheWrite ?? 0,
    reasoning: costRaw?.reasoning ?? 0,
    cost: costRaw?.cost ?? 0,
    byModel: asBucketMap(costRaw?.byModel),
    byProviderModel: asBucketMap(costRaw?.byProviderModel),
  };
}

function billingFromLedger(): SessionStatusBilling {
  try {
    const state = costMeterGetState();
    const month = state.month;
    return {
      todayCost: state.today.cost,
      monthCost: month.cost,
      totalCost: state.total.cost,
      todayTokens: dayTokens(state.today),
      monthTokens: dayTokens(month),
      byModel: rankCostModelRows(asBucketMap(month.byModel)),
      byProviderModel: rankCostModelRows(asBucketMap(month.byProviderModel)),
    };
  } catch {
    return {
      todayCost: 0,
      monthCost: 0,
      totalCost: 0,
      todayTokens: 0,
      monthTokens: 0,
      byModel: [],
      byProviderModel: [],
    };
  }
}

function injectSourceLabel(ev: Extract<ContextTimelineEvent, { kind: "inject" }>): string {
  if (ev.name) return `${ev.source ?? ev.form ?? "inject"}:${ev.name}`;
  if (ev.source) return ev.source;
  if (ev.form) return ev.form;
  return "inject";
}

function summarizeTimelineEvents(
  events: readonly ContextTimelineEvent[] | undefined,
): Pick<
  SessionStatusTimeline,
  | "injectSources"
  | "lastCompactReason"
  | "lastShadowedTokens"
  | "spillCount"
  | "pruneCount"
> & {
  readonly summaryCount: number;
  readonly pipeline: SessionStatusCompactionPipeline;
  readonly stages: readonly SessionStatusCompactionStage[];
} {
  const injectSources: string[] = [];
  const seen = new Set<string>();
  let lastCompactReason: ContextTimelineCompactReason | undefined;
  let lastShadowedTokens: number | undefined;
  let spillCount = 0;
  let pruneCount = 0;
  let summaryCount = 0;
  // Per-turn markers for prune-first → summary pairing (DSH soft-budget order).
  const turnPrune = new Set<number>();
  const turnSummary = new Map<number, ContextTimelineCompactReason>();
  let lastStageTurn = -1;
  for (const ev of events ?? []) {
    if (ev.kind === "inject") {
      const label = injectSourceLabel(ev);
      if (!seen.has(label)) {
        seen.add(label);
        injectSources.push(label);
      }
      continue;
    }
    if (ev.kind === "compaction") {
      summaryCount += 1;
      lastCompactReason = ev.reason;
      if (typeof ev.shadowedTokenCount === "number") {
        lastShadowedTokens = ev.shadowedTokenCount;
      }
      turnSummary.set(ev.turn, ev.reason);
      if (ev.turn >= lastStageTurn) lastStageTurn = ev.turn;
      continue;
    }
    if (ev.kind === "prune") {
      pruneCount += 1;
      if (ev.spill) spillCount += 1;
      turnPrune.add(ev.turn);
      if (ev.turn >= lastStageTurn) lastStageTurn = ev.turn;
    }
  }
  let pipeline: SessionStatusCompactionPipeline = "none";
  const stages: SessionStatusCompactionStage[] = [];
  if (lastStageTurn >= 0) {
    const hadPrune = turnPrune.has(lastStageTurn);
    const hadSummary = turnSummary.has(lastStageTurn);
    if (hadPrune && hadSummary) {
      pipeline = "prune→summary";
      stages.push("prune", "summary");
    } else if (hadPrune) {
      pipeline = "prune";
      stages.push("prune");
    } else if (hadSummary) {
      pipeline = "summary";
      stages.push("summary");
    }
  }
  return {
    injectSources,
    ...(lastCompactReason ? { lastCompactReason } : {}),
    ...(lastShadowedTokens !== undefined
      ? { lastShadowedTokens }
      : {}),
    spillCount,
    pruneCount,
    summaryCount,
    pipeline,
    stages,
  };
}

function deliveryNote(input: {
  readonly turnActive: boolean;
  readonly queued: number;
  readonly steering: number;
}): string {
  if (input.turnActive) {
    const q =
      input.queued > 0
        ? `queue ${input.queued} waiting`
        : "queue accepts";
    const s =
      input.steering > 0
        ? ` · steer ${input.steering}`
        : " · steer ok while turn runs";
    return `turn active · compact blocked · ${q}${s}`;
  }
  if (input.queued > 0 || input.steering > 0) {
    return `idle · queue ${input.queued} · steer ${input.steering} (steer needs an active turn)`;
  }
  return "idle · queue accepts · compact available when agent idle";
}

function liveLineText(
  events: ReturnType<typeof readSessionEvents>,
): { text?: string; tool?: string } {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "assistant/chunk") {
      if (ev.kind === "tool-call" && ev.toolName) {
        return { tool: ev.toolName };
      }
      const text = ev.text?.trim();
      if (text) {
        return { text: text.length > 120 ? `${text.slice(0, 120)}…` : text };
      }
      continue;
    }
    if (ev.type === "tool/call") {
      return { tool: ev.call?.name || "tool" };
    }
    if (ev.type === "assistant/message") {
      const content = ev.content as unknown;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((p: unknown) =>
                  p && typeof p === "object" && "text" in p
                    ? String((p).text)
                    : "",
                )
                .join("")
            : "";
      const trimmed = text.trim();
      if (trimmed) {
        return {
          text: trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed,
        };
      }
    }
  }
  return {};
}

/**
 * Build the Status snapshot for one session.
 * Same facts feed `/status` text and Face `session.status`.
 */
export function buildSessionStatusSnapshot(
  runtime: FaceRuntime,
  sessionId: string,
): SessionStatusSnapshot {
  const events = readSessionEvents(runtime.store, sessionId);
  const badge =
    runtime.sessionAgentPresets.get(sessionId) ?? "(default)";
  const permission = permissionSelectFromEvents(events).currentValue;
  const plan = foldPlanMode(events) ? "on" : "off";
  const model = resolveSessionModelSelection(runtime, sessionId);
  const cwd = resolveSessionCwd(runtime, sessionId);

  const jobs = (runtime.jobViewsFor(sessionId) ?? []).map(jobRow);

  const live: SessionStatusSubagentLive[] = [];
  for (const link of runtime.subagents.listDelegated(sessionId)) {
    if (!runtime.store.has(link.childSessionId)) continue;
    const activity = isChildSessionActive(runtime, link.childSessionId)
      ? ("running" as const)
      : ("inactive" as const);
    const childEvents = readSessionEvents(runtime.store, link.childSessionId);
    const line = activity === "running" ? liveLineText(childEvents) : {};
    const pending = listPendingAdmits(childEvents, link.childSessionId);
    let queued = 0;
    let steering = 0;
    for (const admit of pending) {
      if (admit.delivery === "steer") steering += 1;
      else queued += 1;
    }
    live.push({
      id: link.childSessionId,
      activity,
      mode: link.mode,
      ...(link.label ? { label: link.label } : {}),
      ...(line.text ? { liveText: line.text } : {}),
      ...(line.tool ? { liveTool: line.tool } : {}),
      ...(queued > 0 ? { queued } : {}),
      ...(steering > 0 ? { steering } : {}),
    });
  }

  const quota = resolveSubagentQuota(runtime, sessionId);

  const team = runtime.agentTeams.view(sessionId);
  const graph: SessionStatusGraph = {
    nodes: team.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      ...(n.role ? { role: n.role } : {}),
    })),
    edges: team.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      ...(e.label ? { label: e.label } : {}),
    })),
  };
  const teamTasks = runtime.agentTeamTasks
    .list(sessionId)
    .slice(0, 24)
    .map(teamTaskRow);

  const snap = runtime.projections.snapshot(sessionId);
  const costRaw = snap.values.costUsage as CostUsageProjection | undefined;
  const cost = costFromProjection(costRaw);
  const billing = billingFromLedger();

  const tlRaw = snap.values.contextTimeline as
    | ContextTimelineProjection
    | undefined;
  const current = tlRaw?.current;
  const eventSummary = summarizeTimelineEvents(tlRaw?.events);
  const timeline: SessionStatusTimeline = {
    total: current?.total ?? 0,
    system: current?.system ?? 0,
    tools: current?.tools ?? 0,
    user: current?.user ?? 0,
    inject: current?.inject ?? 0,
    assistant: current?.assistant ?? 0,
    tool: current?.tool ?? 0,
    requestCount: tlRaw?.requests?.length ?? 0,
    eventCount: tlRaw?.events?.length ?? 0,
    ...(tlRaw?.model ? { model: tlRaw.model } : {}),
    ...(tlRaw?.provider ? { provider: tlRaw.provider } : {}),
    ...(tlRaw?.contextWindow !== undefined
      ? { contextWindow: tlRaw.contextWindow }
      : {}),
    injectSources: eventSummary.injectSources,
    ...(eventSummary.lastCompactReason
      ? { lastCompactReason: eventSummary.lastCompactReason }
      : {}),
    ...(eventSummary.lastShadowedTokens !== undefined
      ? { lastShadowedTokens: eventSummary.lastShadowedTokens }
      : {}),
    spillCount: eventSummary.spillCount,
    pruneCount: eventSummary.pruneCount,
  };

  const turnActive = runtime.drain.isActive(sessionId);
  const pending = listPendingAdmits(events, sessionId);
  let queued = 0;
  let steering = 0;
  for (const admit of pending) {
    if (admit.delivery === "steer") steering += 1;
    else queued += 1;
  }
  const compaction: SessionStatusCompaction = {
    pipeline: eventSummary.pipeline,
    stages: eventSummary.stages,
    ...(eventSummary.lastCompactReason
      ? { lastReason: eventSummary.lastCompactReason }
      : {}),
    ...(eventSummary.lastShadowedTokens !== undefined
      ? { lastShadowedTokens: eventSummary.lastShadowedTokens }
      : {}),
    pruneCount: eventSummary.pruneCount,
    summaryCount: eventSummary.summaryCount,
    spillCount: eventSummary.spillCount,
    phase: turnActive ? "busy" : "idle",
  };
  const delivery: SessionStatusDelivery = {
    turnActive,
    queued,
    steering,
    compactBlockedByTurn: turnActive,
    queueAcceptedWhileBusy: true,
    steerRequiresActiveTurn: true,
    note: deliveryNote({ turnActive, queued, steering }),
  };

  const discover = buildFaceChannelDiscover(runtime.plugins, {
    imGatewayWired: resolveImGatewayWired(),
  });
  const channels: SessionStatusChannels = {
    process: discover.process.map((p) => ({
      pluginId: p.pluginId,
      channelId: p.channelId,
      ...(p.displayName ? { displayName: p.displayName } : {}),
    })),
    im: discover.im.map((c) => ({
      channelId: c.channelId,
      displayName: c.displayName,
      wired: c.wired,
    })),
    note: discover.note,
  };

  return {
    sessionId,
    badge,
    permission,
    plan,
    theme: runtime.uiSettings.theme,
    model: { provider: model.provider, model: model.model },
    cwd,
    events: sessionEventCount(runtime.store, sessionId),
    jobs,
    subagents: { live, graph, quota },
    teamTasks,
    cost,
    billing,
    timeline,
    compaction,
    delivery,
    channels,
  };
}

/** Format the shared snapshot as `/status` command text. */
export function formatSessionStatusText(snap: SessionStatusSnapshot): string {
  const lines: string[] = [
    `badge: ${snap.badge}`,
    `permission: ${snap.permission}`,
    `plan: ${snap.plan} (toggle with /plan · /plan off)`,
    `theme: ${snap.theme} (/theme light|dark|system)`,
    `model: ${snap.model.provider}/${snap.model.model}`,
    `cwd: ${snap.cwd}`,
    `events: ${snap.events}`,
  ];

  const runningJobs = snap.jobs.filter((j) => j.status === "running");
  lines.push(
    `jobs: ${snap.jobs.length} total` +
      (runningJobs.length > 0 ? ` (${runningJobs.length} running)` : ""),
  );
  for (const job of snap.jobs.slice(0, 8)) {
    lines.push(
      `  - ${job.id}${job.label ? ` (${job.label})` : ""} [${job.status}]`,
    );
  }

  const runningSubs = snap.subagents.live.filter(
    (s) => s.activity === "running",
  );
  const q = snap.subagents.quota;
  const queuedSubs = snap.subagents.live.reduce(
    (n, s) => n + (s.queued ?? 0) + (s.steering ?? 0),
    0,
  );
  lines.push(
    `subagents: ${snap.subagents.live.length} delegated` +
      (runningSubs.length > 0 ? `, ${runningSubs.length} live` : "") +
      ` · quota depth ${q.depth}/${q.maxDepth} active ${q.active}/${q.maxActive}` +
      ` · slots_free ${q.slotsFree}` +
      (queuedSubs > 0 ? ` · child_inbox ${queuedSubs}` : "") +
      `; graph ${snap.subagents.graph.nodes.length} nodes / ${snap.subagents.graph.edges.length} edges`,
  );
  for (const sub of runningSubs.slice(0, 8)) {
    const tip = sub.liveTool
      ? `tool:${sub.liveTool}`
      : sub.liveText
        ? sub.liveText
        : sub.mode;
    const inbox =
      (sub.queued ?? 0) > 0 || (sub.steering ?? 0) > 0
        ? ` q=${sub.queued ?? 0}/steer=${sub.steering ?? 0}`
        : "";
    lines.push(`  - ${sub.label ?? sub.id} [${tip}]${inbox}`);
  }
  for (const sub of snap.subagents.live
    .filter((s) => s.activity !== "running" && ((s.queued ?? 0) > 0 || (s.steering ?? 0) > 0))
    .slice(0, 4)) {
    lines.push(
      `  - ${sub.label ?? sub.id} [idle · q=${sub.queued ?? 0}/steer=${sub.steering ?? 0}]`,
    );
  }

  const openTasks = snap.teamTasks.filter(
    (t) =>
      t.status === "pending" ||
      t.status === "in_progress" ||
      t.status === "paused",
  );
  lines.push(
    `team tasks: ${snap.teamTasks.length} total` +
      (openTasks.length > 0 ? ` (${openTasks.length} open)` : ""),
  );
  for (const task of snap.teamTasks.slice(0, 8)) {
    const bits = [
      task.status,
      task.role ? `role:${task.role}` : null,
      task.humanOwned ? "human" : null,
      task.worktreeBranch ? `wt:${task.worktreeBranch}` : null,
      task.schemaValid === false
        ? "schema!"
        : task.schemaValid === true
          ? "schema_ok"
          : null,
    ].filter(Boolean);
    lines.push(`  - ${task.title} [${bits.join(" · ")}] (${task.id})`);
  }

  lines.push(
    `cost: $${snap.cost.cost.toFixed(4)} (in ${snap.cost.input} · out ${snap.cost.output}` +
      (snap.cost.cacheRead ? ` · cacheR ${snap.cost.cacheRead}` : "") +
      (snap.cost.reasoning ? ` · reason ${snap.cost.reasoning}` : "") +
      ")",
  );
  const sessionModels = rankCostModelRows(snap.cost.byProviderModel, 6);
  if (sessionModels.length > 0) {
    lines.push("  by model (this session):");
    for (const row of sessionModels) {
      lines.push(
        `    - ${row.key}: $${row.cost.toFixed(4)} (in ${row.input} · out ${row.output})`,
      );
    }
  }
  lines.push(
    `billing: today $${snap.billing.todayCost.toFixed(4)}` +
      ` · month $${snap.billing.monthCost.toFixed(4)}` +
      ` · total $${snap.billing.totalCost.toFixed(4)}` +
      ` (cross-session ledger)`,
  );
  if (snap.billing.byProviderModel.length > 0) {
    lines.push("  by model (month ledger):");
    for (const row of snap.billing.byProviderModel.slice(0, 6)) {
      lines.push(
        `    - ${row.key}: $${row.cost.toFixed(4)} (in ${row.input} · out ${row.output})`,
      );
    }
  }

  lines.push(
    `timeline: total ${snap.timeline.total}` +
      ` (sys ${snap.timeline.system} · tools ${snap.timeline.tools}` +
      ` · user ${snap.timeline.user} · inject ${snap.timeline.inject}` +
      ` · asst ${snap.timeline.assistant} · tool ${snap.timeline.tool})` +
      `; ${snap.timeline.requestCount} requests · ${snap.timeline.eventCount} ctx events`,
  );
  if (snap.timeline.injectSources.length > 0) {
    lines.push(
      `  inject sources: ${snap.timeline.injectSources.slice(0, 8).join(", ")}` +
        (snap.timeline.injectSources.length > 8
          ? ` (+${snap.timeline.injectSources.length - 8})`
          : ""),
    );
  }
  if (snap.timeline.lastCompactReason) {
    lines.push(
      `  last compact: ${snap.timeline.lastCompactReason}` +
        (snap.timeline.lastShadowedTokens !== undefined
          ? ` · shadowed ${snap.timeline.lastShadowedTokens}`
          : ""),
    );
  }
  if (snap.timeline.pruneCount > 0 || snap.timeline.spillCount > 0) {
    lines.push(
      `  prune: ${snap.timeline.pruneCount} · spill: ${snap.timeline.spillCount}`,
    );
  }

  const stageLabel =
    snap.compaction.stages.length > 0
      ? snap.compaction.stages.join("→")
      : snap.compaction.pipeline;
  lines.push(
    `compaction: ${snap.compaction.phase}` +
      ` · pipeline ${stageLabel}` +
      (snap.compaction.lastReason
        ? ` · last ${snap.compaction.lastReason}`
        : "") +
      (snap.compaction.lastShadowedTokens !== undefined
        ? ` · shadowed ${snap.compaction.lastShadowedTokens}`
        : "") +
      ` · prune ${snap.compaction.pruneCount}` +
      ` · summary ${snap.compaction.summaryCount}` +
      (snap.compaction.spillCount > 0
        ? ` · spill ${snap.compaction.spillCount}`
        : ""),
  );
  lines.push(
    `delivery: ${snap.delivery.note}` +
      ` · queued ${snap.delivery.queued}` +
      ` · steering ${snap.delivery.steering}` +
      (snap.delivery.compactBlockedByTurn ? " · compact↔turn exclusive" : ""),
  );

  const wiredIm = snap.channels.im.filter((c) => c.wired !== "bridge");
  lines.push(
    `channels: ${snap.channels.process.length} process` +
      ` · ${snap.channels.im.length} im` +
      (wiredIm.length > 0
        ? ` (gateway: ${wiredIm.map((c) => `${c.channelId}=${c.wired}`).join(", ")})`
        : " (im bridge)"),
  );
  if (snap.channels.note.trim()) {
    lines.push(`  note:${snap.channels.note.trim()}`);
  }

  return lines.join("\n");
}
