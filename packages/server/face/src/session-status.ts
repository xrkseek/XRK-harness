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
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
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
  /** External runtime kind when this child is ACP / app-server backed. */
  readonly externalKind?: "acp" | "app-server";
  /**
   * `live` = process handle attached; `cold` = sidecar handle only (Host
   * restart / dispose) — follow-up may attempt reopen via thread/resume.
   */
  readonly externalResume?: "live" | "cold";
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
  /** Recent daily points from ledger history (Hermes insights / dsh-wallet). */
  readonly dailyTrend: readonly SessionStatusBillingDay[];
}

/** One day on the billing trend sparkline. */
export interface SessionStatusBillingDay {
  readonly date: string;
  readonly cost: number;
  readonly tokens: number;
}

/**
 * Fleet health for Status (subagents · jobs · channels) — Hermes StatusPage
 * style operator glance, not a separate monitoring product.
 */
export type SessionStatusFleetHealth = "ok" | "warn" | "critical";

export interface SessionStatusFleetAlert {
  readonly id: string;
  readonly severity: "info" | "warn" | "critical";
  readonly message: string;
}

export interface SessionStatusFleet {
  readonly health: SessionStatusFleetHealth;
  readonly runningJobs: number;
  readonly runningSubagents: number;
  readonly slotsFree: number;
  readonly queuedInbox: number;
  readonly channelAlerts: number;
  readonly alerts: readonly SessionStatusFleetAlert[];
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
  /** Discover stubs / bridge-only IM that need operator attention. */
  readonly alerts: readonly SessionStatusFleetAlert[];
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
  /**
   * Configured soft-budget strategy (Face `agent-loop.compactionStrategy`).
   * Distinct from last-turn `pipeline` (what actually ran).
   */
  readonly strategy?:
    | "prune-summary"
    | "prune-only"
    | "summary-only"
    | "off";
  readonly lastReason?: ContextTimelineCompactReason;
  readonly lastShadowedTokens?: number;
  readonly pruneCount: number;
  /** Count of `context/compaction` (summary) timeline rows. */
  readonly summaryCount: number;
  readonly spillCount: number;
  /**
   * Recent unique spill files (newest last; capped). Each row may include
   * basename · bytes · head/tail preview when the file is still on disk.
   */
  readonly spillPaths?: readonly SessionStatusSpillEntry[];
  /**
   * Live latch: turn or manual `/compact` holds the agent busy bit
   * (compact and turn are mutually exclusive on the same latch).
   */
  readonly phase: "idle" | "busy";
  /** Thin Guardian fragment registered (Settings `guardianFragments`). */
  readonly guardian?: boolean;
}

/** One tool-result spill file surfaced on Status / Context browse. */
export interface SessionStatusSpillEntry {
  readonly path: string;
  /** Basename for the overview list. */
  readonly name: string;
  /** On-disk UTF-8 byte length when the file is readable. */
  readonly bytes?: number;
  /** Head/tail peek (capped); absent when the file is missing. */
  readonly preview?: string;
  /** Tool name from the prune/spill timeline row when known. */
  readonly tool?: string;
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
  /** Managed lease status (`active` · `retained` · `reclaimed`) when known. */
  readonly worktreeLeaseStatus?: string;
  /** Truncated completion / failure preview from the task board. */
  readonly resultPreview?: string;
  /**
   * External-agent resume surface for the bound child (`live` process vs
   * `cold` sidecar-only). Same values as `subagents.live[].externalResume`.
   */
  readonly externalResume?: "live" | "cold";
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
  /** Subagent / job / channel health glance. */
  readonly fleet: SessionStatusFleet;
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

function teamTaskRow(
  task: AgentTeamTask,
  runtime: FaceRuntime,
): SessionStatusTeamTask {
  const lease =
    task.worktreeId !== undefined
      ? runtime.managedWorktrees.get(task.worktreeId)
      : undefined;
  const externalResume = task.childSessionId
    ? runtime.externalAgents.resumeState(task.childSessionId)
    : undefined;
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
    ...(lease?.status ? { worktreeLeaseStatus: lease.status } : {}),
    ...(task.resultPreview ? { resultPreview: task.resultPreview } : {}),
    ...(externalResume ? { externalResume } : {}),
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
    const history = [...(state.history ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const dailyTrend: SessionStatusBillingDay[] = history.slice(-14).map((day) => ({
      date: day.date,
      cost: day.cost,
      tokens: dayTokens(day),
    }));
    return {
      todayCost: state.today.cost,
      monthCost: month.cost,
      totalCost: state.total.cost,
      todayTokens: dayTokens(state.today),
      monthTokens: dayTokens(month),
      byModel: rankCostModelRows(asBucketMap(month.byModel)),
      byProviderModel: rankCostModelRows(asBucketMap(month.byProviderModel)),
      dailyTrend,
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
      dailyTrend: [],
    };
  }
}

function channelAlertsFromDiscover(channels: {
  readonly process: readonly { readonly channelId: string; readonly displayName?: string }[];
  readonly im: readonly {
    readonly channelId: string;
    readonly displayName: string;
    readonly wired: string;
  }[];
  readonly note: string;
  readonly imGatewayWired?: string;
}): SessionStatusFleetAlert[] {
  const alerts: SessionStatusFleetAlert[] = [];
  const stubIm = channels.im.filter(
    (im) =>
      im.wired === "bridge" ||
      im.wired === "stub" ||
      im.wired === "discover",
  );
  if (stubIm.length > 0) {
    const gateway = channels.imGatewayWired?.trim() || "bridge";
    alerts.push({
      id: "im:discover-stubs",
      severity: "info",
      message: `${stubIm.length} IM Face ids are discover stubs (Host gateway=${gateway}; not native vendor SDKs)`,
    });
  }
  if (channels.process.length === 0 && stubIm.length === channels.im.length) {
    alerts.push({
      id: "channels:empty",
      severity: "info",
      message: "No process channels; IM entries are discover stubs only",
    });
  }
  if (channels.note.trim()) {
    alerts.push({
      id: "channels:note",
      severity: "info",
      message: channels.note.trim().slice(0, 160),
    });
  }
  return alerts.slice(0, 8);
}

function buildFleet(input: {
  readonly jobs: readonly SessionStatusJobRow[];
  readonly live: readonly SessionStatusSubagentLive[];
  readonly quota: SessionStatusSubagentQuota;
  readonly channelAlerts: readonly SessionStatusFleetAlert[];
}): SessionStatusFleet {
  const runningJobs = input.jobs.filter((j) => j.status === "running").length;
  const runningSubagents = input.live.filter((s) => s.activity === "running").length;
  const queuedInbox = input.live.reduce(
    (n, s) => n + (s.queued ?? 0) + (s.steering ?? 0),
    0,
  );
  const alerts: SessionStatusFleetAlert[] = [...input.channelAlerts];
  if (input.quota.slotsFree <= 0 && input.quota.maxActive > 0) {
    alerts.unshift({
      id: "fleet:slots",
      severity: "warn",
      message: `Subagent slots full (${input.quota.active}/${input.quota.maxActive})`,
    });
  }
  if (queuedInbox > 0) {
    alerts.unshift({
      id: "fleet:inbox",
      severity: "warn",
      message: `${queuedInbox} child inbox admit(s) waiting (queue/steer)`,
    });
  }
  if (input.quota.depth >= input.quota.maxDepth && input.quota.maxDepth > 0) {
    alerts.unshift({
      id: "fleet:depth",
      severity: "critical",
      message: `Delegation depth at cap (${input.quota.depth}/${input.quota.maxDepth})`,
    });
  }
  let health: SessionStatusFleetHealth = "ok";
  if (alerts.some((a) => a.severity === "critical")) health = "critical";
  else if (alerts.some((a) => a.severity === "warn")) health = "warn";
  return {
    health,
    runningJobs,
    runningSubagents,
    slotsFree: input.quota.slotsFree,
    queuedInbox,
    channelAlerts: input.channelAlerts.length,
    alerts: alerts.slice(0, 12),
  };
}

function injectSourceLabel(ev: Extract<ContextTimelineEvent, { kind: "inject" }>): string {
  if (ev.name) return `${ev.source ?? ev.form ?? "inject"}:${ev.name}`;
  if (ev.source) return ev.source;
  if (ev.form) return ev.form;
  return "inject";
}

const SPILL_PREVIEW_BUDGET = 480;

/**
 * Peek a spill file for Status/Context browse (basename · bytes · head/tail).
 * Missing files still return a path+name row so the operator can see the locator.
 */
export function peekSpillEntry(
  filePath: string,
  options?: { readonly tool?: string; readonly previewBudget?: number },
): SessionStatusSpillEntry {
  const name = path.basename(filePath) || filePath;
  const tool = options?.tool?.trim();
  const budget = Math.max(80, options?.previewBudget ?? SPILL_PREVIEW_BUDGET);
  try {
    const bytes = statSync(filePath).size;
    const text = readFileSync(filePath, "utf8");
    let preview = text;
    if (Buffer.byteLength(preview, "utf8") > budget) {
      const head = text.slice(0, Math.floor(budget / 3));
      const tail = text.slice(-Math.floor(budget / 3));
      preview = `${head}\n…\n${tail}`;
    }
    preview = preview.trim();
    if (preview.length > 600) preview = `${preview.slice(0, 600)}…`;
    return {
      path: filePath,
      name,
      bytes,
      ...(preview ? { preview } : {}),
      ...(tool ? { tool } : {}),
    };
  } catch {
    return {
      path: filePath,
      name,
      ...(tool ? { tool } : {}),
    };
  }
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
  readonly spillPaths: readonly SessionStatusSpillEntry[];
} {
  const injectSources: string[] = [];
  const seen = new Set<string>();
  let lastCompactReason: ContextTimelineCompactReason | undefined;
  let lastShadowedTokens: number | undefined;
  let spillCount = 0;
  let pruneCount = 0;
  let summaryCount = 0;
  const spillPathList: SessionStatusSpillEntry[] = [];
  const spillPathSeen = new Set<string>();
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
      const filePath =
        typeof ev.spillPath === "string" ? ev.spillPath.trim() : "";
      if (filePath && !spillPathSeen.has(filePath)) {
        spillPathSeen.add(filePath);
        spillPathList.push(
          peekSpillEntry(filePath, {
            ...(ev.tool ? { tool: ev.tool } : {}),
          }),
        );
      }
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
    spillPaths: spillPathList.slice(-12),
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
    const externalKind = runtime.externalAgents.kind(link.childSessionId);
    const externalResume = runtime.externalAgents.resumeState(link.childSessionId);
    live.push({
      id: link.childSessionId,
      activity,
      mode: link.mode,
      ...(link.label ? { label: link.label } : {}),
      ...(line.text ? { liveText: line.text } : {}),
      ...(line.tool ? { liveTool: line.tool } : {}),
      ...(queued > 0 ? { queued } : {}),
      ...(steering > 0 ? { steering } : {}),
      ...(externalKind ? { externalKind } : {}),
      ...(externalResume ? { externalResume } : {}),
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
    .map((t) => teamTaskRow(t, runtime));

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
  const loopValue = runtime.settingsNamespaces.view("agent-loop").value as Record<
    string,
    unknown
  >;
  const strategyRaw = String(loopValue.compactionStrategy ?? "").trim();
  const strategy =
    strategyRaw === "prune-summary" ||
    strategyRaw === "prune-only" ||
    strategyRaw === "summary-only" ||
    strategyRaw === "off"
      ? strategyRaw
      : "prune-summary";
  const guardian = loopValue.guardianFragments !== false;
  const compaction: SessionStatusCompaction = {
    pipeline: eventSummary.pipeline,
    stages: eventSummary.stages,
    strategy,
    guardian,
    ...(eventSummary.lastCompactReason
      ? { lastReason: eventSummary.lastCompactReason }
      : {}),
    ...(eventSummary.lastShadowedTokens !== undefined
      ? { lastShadowedTokens: eventSummary.lastShadowedTokens }
      : {}),
    pruneCount: eventSummary.pruneCount,
    summaryCount: eventSummary.summaryCount,
    spillCount: eventSummary.spillCount,
    ...(eventSummary.spillPaths.length > 0
      ? { spillPaths: eventSummary.spillPaths }
      : {}),
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
  const channelAlertRows = channelAlertsFromDiscover({
    process: discover.process,
    im: discover.im,
    note: discover.note,
    imGatewayWired: discover.imGatewayWired,
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
    alerts: channelAlertRows,
  };
  const fleet = buildFleet({
    jobs,
    live,
    quota,
    channelAlerts: channelAlertRows,
  });

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
    fleet,
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
    const ext =
      sub.externalKind
        ? ` · ext:${sub.externalKind}${sub.externalResume ? `/${sub.externalResume}` : ""}`
        : "";
    lines.push(`  - ${sub.label ?? sub.id} [${tip}]${inbox}${ext}`);
  }
  for (const sub of snap.subagents.live
    .filter(
      (s) =>
        s.activity !== "running" &&
        (s.externalResume === "cold" ||
          (s.queued ?? 0) > 0 ||
          (s.steering ?? 0) > 0),
    )
    .slice(0, 4)) {
    const ext =
      sub.externalKind
        ? ` · ext:${sub.externalKind}${sub.externalResume ? `/${sub.externalResume}` : ""}`
        : "";
    lines.push(
      `  - ${sub.label ?? sub.id} [idle · q=${sub.queued ?? 0}/steer=${sub.steering ?? 0}]${ext}`,
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
      task.externalResume ? `ext/${task.externalResume}` : null,
      task.childSessionId ? `child:${task.childSessionId}` : null,
      task.worktreeBranch ? `wt:${task.worktreeBranch}` : null,
      task.schemaValid === false
        ? "schema!"
        : task.schemaValid === true
          ? "schema_ok"
          : null,
    ].filter(Boolean);
    lines.push(`  - ${task.title} [${bits.join(" · ")}] (${task.id})`);
    if (task.resultPreview) {
      lines.push(`      result: ${task.resultPreview}`);
    }
    if (task.worktreePath) {
      lines.push(`      worktree: ${task.worktreePath}`);
    }
    if (task.worktreeLeaseStatus) {
      lines.push(
        `      worktree_lease: ${task.worktreeLeaseStatus}` +
          (task.worktreeLeaseStatus === "retained"
            ? " (ff-only merge blocked — lease kept; Status「合回」或 Face worktree.merge)"
            : task.worktreeLeaseStatus === "active"
              ? " (Status「合回」→ Face worktree.merge)"
              : ""),
      );
    }
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
  if (snap.billing.dailyTrend.length > 0) {
    const recent = snap.billing.dailyTrend.slice(-7);
    lines.push(
      `  daily: ${recent.map((d) => `${d.date.slice(5)}=$${d.cost.toFixed(2)}`).join(" · ")}`,
    );
  }
  if (snap.billing.byProviderModel.length > 0) {
    lines.push("  by model (month ledger):");
    for (const row of snap.billing.byProviderModel.slice(0, 6)) {
      lines.push(
        `    - ${row.key}: $${row.cost.toFixed(4)} (in ${row.input} · out ${row.output})`,
      );
    }
  }

  lines.push(
    `fleet: ${snap.fleet.health}` +
      ` · jobs ${snap.fleet.runningJobs} running` +
      ` · subs ${snap.fleet.runningSubagents} live` +
      ` · slots_free ${snap.fleet.slotsFree}` +
      (snap.fleet.queuedInbox > 0 ? ` · inbox ${snap.fleet.queuedInbox}` : "") +
      (snap.fleet.channelAlerts > 0
        ? ` · channel_alerts ${snap.fleet.channelAlerts}`
        : ""),
  );
  for (const alert of snap.fleet.alerts.slice(0, 6)) {
    lines.push(`  - [${alert.severity}] ${alert.message}`);
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
      (snap.compaction.strategy
        ? ` · strategy ${snap.compaction.strategy}`
        : "") +
      (snap.compaction.guardian ? " · guardian on" : "") +
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
  if (snap.compaction.spillPaths && snap.compaction.spillPaths.length > 0) {
    for (const entry of snap.compaction.spillPaths.slice(-6)) {
      const bits = [
        entry.name,
        entry.tool ? `tool:${entry.tool}` : null,
        entry.bytes !== undefined ? `${entry.bytes}B` : null,
      ].filter(Boolean);
      lines.push(`  spill: ${bits.join(" · ")} · ${entry.path}`);
      if (entry.preview) {
        const oneLine = entry.preview.replace(/\s+/g, " ").slice(0, 120);
        lines.push(`      preview: ${oneLine}`);
      }
    }
  }
  lines.push(
    `delivery: ${snap.delivery.note}` +
      ` · queued ${snap.delivery.queued}` +
      ` · steering ${snap.delivery.steering}` +
      (snap.delivery.compactBlockedByTurn ? " · compact↔turn exclusive" : ""),
  );

  const wiredIm = snap.channels.im.filter((c) => c.wired !== "bridge" && c.wired !== "discover");
  lines.push(
    `channels: ${snap.channels.process.length} process` +
      ` · ${snap.channels.im.length} im discover` +
      (wiredIm.length > 0
        ? ` (native-wired: ${wiredIm.map((c) => `${c.channelId}=${c.wired}`).join(", ")})`
        : " (stubs · Host gateway via env)"),
  );
  if (snap.channels.note.trim()) {
    lines.push(`  note:${snap.channels.note.trim()}`);
  }

  return lines.join("\n");
}
