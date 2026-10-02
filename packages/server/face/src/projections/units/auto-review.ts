import type { SessionEvent } from "@xrkseek/protocol";
import { parseAutoReviewSlashInput } from "../../auto-review-slash.js";
import type { ProjectionDefinition } from "../registry.js";

export interface AutoReviewProjection {
  readonly enabled: boolean;
  readonly verdictsUsed: number;
  readonly failuresUsed: number;
  readonly allows: number;
  readonly denies: number;
  readonly fallbacks: number;
  readonly neverRejects: number;
  readonly avgDurationMs: number;
  readonly circuit: null | {
    readonly trip: { readonly kind: string; readonly count: number };
    readonly action: string;
  };
  readonly recentDenies: ReadonlyArray<{
    readonly reviewId: string;
    readonly toolName: string;
  }>;
  readonly recent: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Live counters from dsh-compat tool-pre / classify / approve
 * (`~/.xrk/auto-review/stats.json`). Host injects the reader.
 */
export interface AutoReviewLiveStats {
  readonly allows: number;
  readonly denies: number;
  readonly verdictsUsed: number;
  readonly failuresUsed: number;
  readonly fallbacks: number;
  readonly neverRejects: number;
  /** Precomputed mean; `0` when no samples. */
  readonly avgDurationMs: number;
  readonly recentDenies: ReadonlyArray<{
    readonly reviewId: string;
    readonly toolName: string;
  }>;
}

export interface AutoReviewUnitState {
  readonly enabled: boolean;
  readonly allows: number;
  readonly denies: number;
  readonly fallbacks: number;
  readonly neverRejects: number;
  readonly verdictsUsed: number;
  readonly failuresUsed: number;
  readonly totalDurationMs: number;
  readonly verdictSamples: number;
  readonly recentDenies: AutoReviewProjection["recentDenies"];
  readonly recent: AutoReviewProjection["recent"];
  readonly circuit: AutoReviewProjection["circuit"];
}

const EMPTY: AutoReviewUnitState = {
  enabled: false,
  allows: 0,
  denies: 0,
  fallbacks: 0,
  neverRejects: 0,
  verdictsUsed: 0,
  failuresUsed: 0,
  totalDurationMs: 0,
  verdictSamples: 0,
  recentDenies: [],
  recent: [],
  circuit: null,
};

function view(
  state: AutoReviewUnitState,
  live?: AutoReviewLiveStats,
): AutoReviewProjection {
  const foldAvg =
    state.verdictSamples > 0
      ? Math.round(state.totalDurationMs / state.verdictSamples)
      : 0;
  return {
    enabled: state.enabled,
    verdictsUsed: live?.verdictsUsed ?? state.verdictsUsed,
    failuresUsed: live?.failuresUsed ?? state.failuresUsed,
    allows: live?.allows ?? state.allows,
    denies: live?.denies ?? state.denies,
    fallbacks: live?.fallbacks ?? state.fallbacks,
    neverRejects: live?.neverRejects ?? state.neverRejects,
    avgDurationMs: live?.avgDurationMs ?? foldAvg,
    // Circuit breaker is a later Loop item — never invent a trip here.
    circuit: null,
    recentDenies: live?.recentDenies ?? state.recentDenies,
    recent: state.recent,
  };
}

function applyCommandArgs(
  state: AutoReviewUnitState,
  args: string,
): AutoReviewUnitState {
  const action = parseAutoReviewSlashInput(args);
  if (!action) return state;
  if (action.kind === "enable") return { ...state, enabled: true };
  if (action.kind === "disable") return { ...state, enabled: false };
  if (action.index < 0 || action.index >= state.recentDenies.length) {
    return state;
  }
  const recentDenies = state.recentDenies.filter((_, i) => i !== action.index);
  return { ...state, recentDenies, allows: state.allows + 1 };
}

export function createAutoReviewProjectionUnit(options?: {
  /** Overlay durable tool-pre stats onto wire (Host / dsh-compat store). */
  readonly readLiveStats?: () => AutoReviewLiveStats | undefined;
}): ProjectionDefinition<"autoReview", AutoReviewUnitState, AutoReviewProjection> {
  return {
    key: "autoReview",
    stateVersion: 1,
    init: () => EMPTY,
    apply(state, event: SessionEvent): AutoReviewUnitState {
      if (event.type === "command/run" && event.name === "auto-review") {
        const args =
          typeof event.args === "string" ? event.args : "";
        return applyCommandArgs(state, args);
      }
      return state;
    },
    wire: {
      view: (state) => view(state, options?.readLiveStats?.()),
      parse(value: unknown): AutoReviewProjection {
        if (!value || typeof value !== "object") {
          throw new Error("autoReview projection must be an object");
        }
        const v = value as Partial<AutoReviewProjection>;
        if (typeof v.enabled !== "boolean") {
          throw new Error("autoReview.enabled must be boolean");
        }
        // Parse validates the wire shape; do not re-read live stats here.
        const avg = Number(v.avgDurationMs ?? 0);
        return view({
          enabled: v.enabled,
          allows: Number(v.allows ?? 0),
          denies: Number(v.denies ?? 0),
          fallbacks: Number(v.fallbacks ?? 0),
          neverRejects: Number(v.neverRejects ?? 0),
          verdictsUsed: Number(v.verdictsUsed ?? 0),
          failuresUsed: Number(v.failuresUsed ?? 0),
          totalDurationMs: avg,
          verdictSamples: avg > 0 ? 1 : 0,
          recentDenies: Array.isArray(v.recentDenies) ? v.recentDenies : [],
          recent: Array.isArray(v.recent) ? v.recent : [],
          circuit: v.circuit ?? null,
        });
      },
    },
  };
}

export function narrateAutoReviewCommand(
  args: string,
  enabledBefore: boolean,
): string {
  const input = args.trim();
  if (input === "off") return enabledBefore ? "auto-review disabled" : "already off";
  if (input === "on" || input === "") {
    return enabledBefore ? "already on" : "auto-review enabled";
  }
  if (/^approve/u.test(input)) return `approved retry (${input})`;
  return `auto-review: ${input}`;
}
