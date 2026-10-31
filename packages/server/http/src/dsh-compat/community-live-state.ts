/**
 * Live fields for community pet overlays (dsh-whale-girl).
 *
 * DSH Host half holds Cordis `tokenMeter` + a current session pointer and
 * refreshes balance on a timer. XRK has no that fiber: Face projections +
 * cost-meter ledger are the sources. Poll handlers must stay O(active), not
 * O(all sessions) — never fold cold logs on every `/api/state`.
 */
import os from "node:os";
import type { XrkWalletPort } from "./underlying/contracts/wallet-port.js";

/** Whale default window when Face has not stamped contextWindow yet. */
export const WHALE_DEFAULT_CONTEXT_LIMIT = 600_000;

export interface CommunityLiveMeter {
  readonly contextTokens?: number;
  readonly contextLimit?: number;
  readonly lastTurnCost?: number | null;
  readonly subagentRunning?: number;
  readonly workState?: "idle" | "thinking" | "done";
  readonly workStateSince?: number;
  /** Prefer Host cost-meter — avoids walletPort fan-out on each poll. */
  readonly balance?: number | null;
  readonly currency?: string;
  readonly todayUsage?: number;
}

export interface CommunityLiveStateOptions {
  readonly walletPort?: XrkWalletPort;
  readonly resolveLiveMeter?: () =>
    | CommunityLiveMeter
    | Promise<CommunityLiveMeter>;
}

export function isWhaleGirlSlug(slug: string): boolean {
  const s = slug.trim().toLowerCase();
  return (
    s === "whale-girl" ||
    s === "dsh-whale-girl" ||
    s.endsWith("/whale-girl") ||
    s.endsWith("/dsh-whale-girl")
  );
}

export function computeContextPct(tokens: number, limit: number): number {
  if (limit <= 0 || tokens <= 0) return 0;
  return Math.min(1, tokens / limit);
}

/** Peak/off-peak band in Beijing time — same windows as upstream whale Host. */
export function computePeakLow(now = new Date()): "high" | "low" {
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const dow = bj.getUTCDay();
  if (dow === 0 || dow === 6) return "low";
  const hour = bj.getUTCHours();
  if ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) return "high";
  return "low";
}

let lastCpuTimes: { total: number; busy: number } | undefined;

export function readSysInfo(): {
  memPct: number;
  memUsed: number;
  memTotal: number;
  cpu: number;
} {
  try {
    const total = os.totalmem();
    const used = total - os.freemem();
    const memPct = total > 0 ? Math.round((used / total) * 100) : 0;
    const cpus = os.cpus();
    let cpuTotal = 0;
    let cpuIdle = 0;
    for (const c of cpus) {
      const t = c.times;
      cpuTotal +=
        (t.user || 0) +
        (t.nice || 0) +
        (t.sys || 0) +
        (t.idle || 0) +
        (t.irq || 0);
      cpuIdle += t.idle || 0;
    }
    const cpuBusy = cpuTotal - cpuIdle;
    let cpu = 0;
    if (lastCpuTimes) {
      const dTotal = cpuTotal - lastCpuTimes.total;
      const dBusy = cpuBusy - lastCpuTimes.busy;
      if (dTotal > 0) cpu = Math.min(100, Math.round((dBusy / dTotal) * 100));
    }
    lastCpuTimes = { total: cpuTotal, busy: cpuBusy };
    return {
      memPct,
      memUsed: Math.round((used / 1024 ** 3) * 10) / 10,
      memTotal: Math.round((total / 1024 ** 3) * 10) / 10,
      cpu,
    };
  } catch {
    return { memPct: 0, memUsed: 0, memTotal: 0, cpu: 0 };
  }
}

/** Align with widget refreshMs (10s); avoid re-hitting ledger/projections. */
const ENRICH_CACHE_MS = 5_000;
let enrichCache:
  | { readonly at: number; readonly live: Record<string, unknown> }
  | undefined;

/**
 * Merge persisted surface state with Host live meter (preferred) / wallet fallback.
 */
export async function enrichWhaleGirlState(
  surfaceState: Record<string, unknown>,
  options: CommunityLiveStateOptions,
): Promise<Record<string, unknown>> {
  const now = Date.now();
  // Host live meter already caches (community-live-bridge). Skip this layer's
  // cache when a resolver is wired so a cold no-meter hit cannot mask a later
  // meter for ENRICH_CACHE_MS (unit tests + brief Host wiring windows).
  if (
    !options.resolveLiveMeter &&
    enrichCache &&
    now - enrichCache.at < ENRICH_CACHE_MS
  ) {
    return {
      ...surfaceState,
      ...enrichCache.live,
      sysInfo: readSysInfo(),
      peakLow: computePeakLow(),
    };
  }

  let meter: CommunityLiveMeter | undefined;
  if (options.resolveLiveMeter) {
    try {
      meter = await options.resolveLiveMeter();
    } catch {
      meter = undefined;
    }
  }

  let balance: number | null =
    typeof meter?.balance === "number"
      ? meter.balance
      : typeof surfaceState.balance === "number"
        ? surfaceState.balance
        : null;
  let currency =
    typeof meter?.currency === "string" && meter.currency.trim()
      ? meter.currency
      : typeof surfaceState.currency === "string" && surfaceState.currency.trim()
        ? surfaceState.currency
        : "CNY";
  const todayUsage =
    typeof meter?.todayUsage === "number"
      ? meter.todayUsage
      : typeof surfaceState.todayUsage === "number"
        ? surfaceState.todayUsage
        : 0;
  const lastTurnCost =
    typeof meter?.lastTurnCost === "number"
      ? meter.lastTurnCost
      : typeof surfaceState.lastTurnCost === "number"
        ? surfaceState.lastTurnCost
        : null;

  // Fallback only when Host meter omitted balance — one cheap read, not usage+cost.
  if (balance === null && options.walletPort) {
    try {
      const view = await options.walletPort.getBalanceView();
      if (typeof view.total === "number" && Number.isFinite(view.total)) {
        balance = view.total;
      }
      if (typeof view.currency === "string" && view.currency.trim()) {
        currency = view.currency;
      }
    } catch {
      /* keep null → coalesce below */
    }
  }

  // Pre-enrich community-root contract: always a number (never null).
  if (balance === null) balance = 0;

  const contextTokens =
    typeof meter?.contextTokens === "number" && meter.contextTokens >= 0
      ? meter.contextTokens
      : typeof surfaceState.contextTokens === "number"
        ? surfaceState.contextTokens
        : 0;
  const contextLimit =
    typeof meter?.contextLimit === "number" && meter.contextLimit > 0
      ? meter.contextLimit
      : typeof surfaceState.contextLimit === "number" &&
          surfaceState.contextLimit > 0
        ? surfaceState.contextLimit
        : WHALE_DEFAULT_CONTEXT_LIMIT;

  const live: Record<string, unknown> = {
    balance,
    currency,
    todayUsage,
    contextPct: computeContextPct(contextTokens, contextLimit),
    contextTokens,
    contextLimit,
    lastTurnCost,
    refreshMs: 10_000,
    subagentRunning:
      typeof meter?.subagentRunning === "number" ? meter.subagentRunning : 0,
  };
  enrichCache = { at: now, live };

  return {
    ...surfaceState,
    ...live,
    peakLow: computePeakLow(),
    sysInfo: readSysInfo(),
  };
}

export function whaleWorkStatePayload(
  meter: CommunityLiveMeter | undefined,
): { state: string; since: number } {
  let state = meter?.workState ?? "idle";
  const since = meter?.workStateSince ?? Date.now();
  const age = Date.now() - since;
  if (state === "done" && age > 30_000) state = "idle";
  if (state === "thinking" && age > 600_000) state = "idle";
  return { state, since };
}
