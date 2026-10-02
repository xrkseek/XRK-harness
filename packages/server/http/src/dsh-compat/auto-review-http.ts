/**
 * dsh-auto-review — settings + stats persist under ~/.xrk.
 * Classify uses the heuristic by default, or a plugged classifier
 * (`options.classifier` / `XRK_AUTO_REVIEW_CLASSIFIER_URL`).
 * Face `autoReview` projection handles session slash; HTTP serves DSH client panel polls.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { sendJson } from "./underlying/http-json.js";
import { honestReady } from "./honest-envelope.js";
import { parseAutoReviewSlashInput } from "./auto-review-slash.js";
import {
  classifyAutoReview,
  resolveAutoReviewClassifier,
  type AutoReviewClassifierOptions,
} from "./auto-review-classifier.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { createPersistedSettingsDocStore } from "./persisted-settings-store.js";
import { dshSettingsDefaults } from "./settings-defaults.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface AutoReviewOptions extends AutoReviewClassifierOptions {
  readonly xrkHome?: string;
  /**
   * Host Face bridge: allow the Nth pending Auto-review approval (0-based).
   * When omitted, HTTP `/auto-review/approve` only mutates stats.
   */
  readonly approvePending?: (args: {
    readonly index: number;
    readonly sessionId?: string;
  }) => {
    readonly allowed: boolean;
    readonly note: string;
    readonly toolName?: string;
  };
}

interface AutoReviewStats {
  allows: number;
  denies: number;
  verdictsUsed: number;
  failuresUsed: number;
  /** Deny remapped to Face ask (DSH user-approval fallback). */
  fallbacks: number;
  /** Final hard reject under approval `never` / fail-closed deny. */
  neverRejects: number;
  /** Sum of classifier wall times (ms) across {@link verdictSamples}. */
  totalDurationMs: number;
  /** Completed classify samples feeding {@link avgDurationMs}. */
  verdictSamples: number;
  recentDenies: Array<{ reviewId: string; toolName: string }>;
}

/** Immutable slice Face `autoReview` projection overlays from tool-pre / HTTP. */
export interface AutoReviewStatsSnapshot {
  readonly allows: number;
  readonly denies: number;
  readonly verdictsUsed: number;
  readonly failuresUsed: number;
  readonly fallbacks: number;
  readonly neverRejects: number;
  /** Rounded mean classify duration; `0` when no samples. */
  readonly avgDurationMs: number;
  readonly recentDenies: ReadonlyArray<{
    readonly reviewId: string;
    readonly toolName: string;
  }>;
}

const EMPTY_STATS: AutoReviewStats = {
  allows: 0,
  denies: 0,
  verdictsUsed: 0,
  failuresUsed: 0,
  fallbacks: 0,
  neverRejects: 0,
  totalDurationMs: 0,
  verdictSamples: 0,
  recentDenies: [],
};

/** Coerce older `stats.json` rows missing newer counters to zeros. */
function normalizeStats(raw: Partial<AutoReviewStats> | AutoReviewStats): AutoReviewStats {
  return {
    allows: Number(raw.allows ?? 0) || 0,
    denies: Number(raw.denies ?? 0) || 0,
    verdictsUsed: Number(raw.verdictsUsed ?? 0) || 0,
    failuresUsed: Number(raw.failuresUsed ?? 0) || 0,
    fallbacks: Number(raw.fallbacks ?? 0) || 0,
    neverRejects: Number(raw.neverRejects ?? 0) || 0,
    totalDurationMs: Number(raw.totalDurationMs ?? 0) || 0,
    verdictSamples: Number(raw.verdictSamples ?? 0) || 0,
    recentDenies: Array.isArray(raw.recentDenies) ? raw.recentDenies : [],
  };
}

function avgDurationMsFrom(stats: AutoReviewStats): number {
  return stats.verdictSamples > 0
    ? Math.round(stats.totalDurationMs / stats.verdictSamples)
    : 0;
}

function withDuration(
  stats: AutoReviewStats,
  durationMs?: number,
): AutoReviewStats {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return stats;
  }
  return {
    ...stats,
    totalDurationMs: stats.totalDurationMs + Math.round(durationMs),
    verdictSamples: stats.verdictSamples + 1,
  };
}

const STATS_STORE = createXrkDocStore(
  ["auto-review", "stats.json"],
  EMPTY_STATS,
);

function settingsStore(options: AutoReviewOptions) {
  return createPersistedSettingsDocStore(
    options.xrkHome,
    "autoReview",
    dshSettingsDefaults("autoReview"),
  );
}

function loadStats(options: AutoReviewOptions): AutoReviewStats {
  return normalizeStats(STATS_STORE.read(options.xrkHome).data);
}

/**
 * Read durable tool-pre / classify / approve counters under `~/.xrk`.
 * Face projection overlays these onto session `autoReview` wire (circuit deferred).
 */
export function readAutoReviewStats(
  options: AutoReviewOptions = {},
): AutoReviewStatsSnapshot {
  const stats = loadStats(options);
  return {
    allows: stats.allows,
    denies: stats.denies,
    verdictsUsed: stats.verdictsUsed,
    failuresUsed: stats.failuresUsed,
    fallbacks: stats.fallbacks,
    neverRejects: stats.neverRejects,
    avgDurationMs: avgDurationMsFrom(stats),
    recentDenies: stats.recentDenies.map((row) => ({
      reviewId: row.reviewId,
      toolName: row.toolName,
    })),
  };
}

function saveStats(
  options: AutoReviewOptions,
  stats: AutoReviewStats,
): AutoReviewStats {
  return STATS_STORE.write(options.xrkHome, stats).data;
}

function isEnabled(options: AutoReviewOptions): boolean {
  const row = settingsStore(options).value();
  return row.enabled === true;
}

/** Host / tool-pre read of dsh-compat auto-review enable (slash · HTTP toggle). */
export function isAutoReviewEnabled(options: AutoReviewOptions = {}): boolean {
  return isEnabled(options);
}

function setEnabled(options: AutoReviewOptions, enabled: boolean): void {
  settingsStore(options).replaceUser({ enabled });
}

/** Persist Face Settings `auto-review.enabled` into the dsh-compat store. */
export function setAutoReviewEnabled(
  options: AutoReviewOptions,
  enabled: boolean,
): void {
  setEnabled(options, enabled);
}

function statusPayload(options: AutoReviewOptions): Record<string, unknown> {
  const store = settingsStore(options);
  const stats = loadStats(options);
  const classifier = resolveAutoReviewClassifier(options);
  const enabled = isEnabled(options);
  return {
    ok: true,
    enabled,
    status: enabled ? "ready" : "offline",
    writable: true,
    adapter: DSH_COMPAT_ADAPTER,
    classifier: classifier.id,
    classifierKind: classifier.kind,
    settingsRevision: store.revision(),
    allows: stats.allows,
    denies: stats.denies,
    verdictsUsed: stats.verdictsUsed,
    failuresUsed: stats.failuresUsed,
    fallbacks: stats.fallbacks,
    neverRejects: stats.neverRejects,
    avgDurationMs: avgDurationMsFrom(stats),
    recentDenies: stats.recentDenies,
    note:
      classifier.kind === "heuristic"
        ? "Classifier tiers: heuristic (active) | http (Settings URL / XRK_AUTO_REVIEW_CLASSIFIER_URL) | session-llm (Host resolveLlm). Auto permission = no sandbox + per-call review (not a context-fragment)."
        : classifier.kind === "http"
          ? "Classifier tier http (active). Tiers: heuristic | http | session-llm. Auto = no sandbox + per-call review."
          : classifier.kind === "session-llm"
            ? "Classifier tier session-llm (active). Tiers: heuristic | http | session-llm. Auto = no sandbox + per-call review."
            : `Classifier seam active (${classifier.kind}). Tiers: heuristic | http | session-llm.`,
  };
}

export async function handleAutoReviewHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: AutoReviewOptions = {},
): Promise<boolean> {
  if (!pathname.startsWith("/auto-review")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const sub = pathname.replace(/^\/auto-review\/?/, "") || "status";

  if (sub === "status" || sub === "") {
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      if (typeof body.enabled === "boolean") {
        setEnabled(options, body.enabled);
      }
    }
    sendJson(res, 200, statusPayload(options));
    return true;
  }

  if (sub === "toggle" || sub === "enabled") {
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const next =
        typeof body.enabled === "boolean"
          ? body.enabled
          : !isEnabled(options);
      setEnabled(options, next);
    }
    sendJson(res, 200, statusPayload(options));
    return true;
  }

  if (sub === "approve" && (method === "POST" || method === "PUT")) {
    const body = await parseJsonBody(req);
    const index =
      typeof body.index === "number"
        ? body.index
        : Number(body.index ?? 1) - 1;
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : undefined;
    let pendingNote: string | undefined;
    let pendingAllowed = false;
    if (options.approvePending) {
      if (!sessionId) {
        pendingNote =
          "no sessionId in approve body; cannot locate a pending Face approval";
      } else {
        const pending = options.approvePending({ index, sessionId });
        pendingAllowed = pending.allowed;
        pendingNote = pending.note;
      }
    } else {
      pendingNote =
        "no Face approval bridge; stats-only approve (no pending respond)";
    }
    const stats = loadStats(options);
    let clearedRecentDeny = false;
    if (
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < stats.recentDenies.length
    ) {
      const recentDenies = stats.recentDenies.filter((_, i) => i !== index);
      saveStats(options, {
        ...stats,
        recentDenies,
        allows: stats.allows + 1,
      });
      clearedRecentDeny = true;
    } else if (pendingAllowed) {
      saveStats(options, {
        ...stats,
        allows: stats.allows + 1,
      });
    }
    const noteParts = [
      pendingNote,
      clearedRecentDeny
        ? `cleared recent deny #${index + 1}`
        : pendingAllowed
          ? undefined
          : Number.isSafeInteger(index) && index >= 0
            ? `no recent deny at index ${index + 1}`
            : undefined,
    ].filter((part): part is string => typeof part === "string" && part !== "");
    sendJson(res, 200, {
      ...statusPayload(options),
      approved: pendingAllowed,
      clearedRecentDeny,
      note: noteParts.join("; "),
    });
    return true;
  }

  if (
    sub === "classify" ||
    sub === "review" ||
    sub === "verdict" ||
    sub.startsWith("classify/")
  ) {
    const body =
      method === "POST" || method === "PUT"
        ? await parseJsonBody(req)
        : {};
    if (!isEnabled(options)) {
      const classifier = resolveAutoReviewClassifier(options);
      sendJson(res, 200, {
        ok: false,
        enabled: false,
        code: "AUTO_REVIEW_DISABLED",
        endpoint: sub,
        classifier: classifier.id,
        adapter: DSH_COMPAT_ADAPTER,
        message: "Auto-review is disabled",
      });
      return true;
    }
    const result = await classifyAutoReview(body, options);
    const stats = loadStats(options);
    const verdict = result.classification.verdict;
    if (!result.ok) {
      saveStats(options, {
        ...stats,
        failuresUsed: stats.failuresUsed + 1,
      });
    } else if (verdict === "deny") {
      saveStats(options, {
        ...stats,
        denies: stats.denies + 1,
        neverRejects: stats.neverRejects + 1,
        verdictsUsed: stats.verdictsUsed + 1,
        recentDenies: [
          {
            reviewId: randomUUID(),
            toolName: String(body.toolName ?? body.name ?? "tool"),
          },
          ...stats.recentDenies,
        ].slice(0, 8),
      });
    } else if (verdict === "allow") {
      saveStats(options, {
        ...stats,
        allows: stats.allows + 1,
        verdictsUsed: stats.verdictsUsed + 1,
      });
    }
    sendJson(res, 200, {
      ok: result.ok,
      ...result.classification,
      classifier: result.classifier,
      adapter: DSH_COMPAT_ADAPTER,
      ...(result.error ? { error: result.error } : {}),
      note: result.ok
        ? "Classifier seam. Default is session LLM when no URL; else heuristic."
        : "Classifier failed closed (deny).",
    });
    return true;
  }

  if (method === "POST" || method === "PUT") await parseJsonBody(req);
  sendJson(res, 200, honestReady({ path: pathname, endpoint: sub }));
  return true;
}

export function isAutoReviewPath(pathname: string): boolean {
  return pathname.startsWith("/auto-review");
}

/** Record a final hard deny (approval `never` / fail-closed). */
export function recordAutoReviewDeny(
  options: AutoReviewOptions,
  toolName: string,
  durationMs?: number,
): void {
  const stats = withDuration(loadStats(options), durationMs);
  saveStats(options, {
    ...stats,
    denies: stats.denies + 1,
    neverRejects: stats.neverRejects + 1,
    verdictsUsed: stats.verdictsUsed + 1,
    recentDenies: [
      { reviewId: randomUUID(), toolName },
      ...stats.recentDenies,
    ].slice(0, 8),
  });
}

/** Record an allow (tool-pre / classify path). */
export function recordAutoReviewAllow(
  options: AutoReviewOptions = {},
  durationMs?: number,
): void {
  const stats = withDuration(loadStats(options), durationMs);
  saveStats(options, {
    ...stats,
    allows: stats.allows + 1,
    verdictsUsed: stats.verdictsUsed + 1,
  });
}

/**
 * Record a deny remapped to Face ask (DSH user-approval fallback).
 * Does not append {@link recentDenies} — those track final hard rejects.
 */
export function recordAutoReviewFallback(
  options: AutoReviewOptions = {},
  durationMs?: number,
): void {
  const stats = withDuration(loadStats(options), durationMs);
  saveStats(options, {
    ...stats,
    fallbacks: stats.fallbacks + 1,
    verdictsUsed: stats.verdictsUsed + 1,
  });
}

/**
 * Mirror Face `/auto-review` slash into ~/.xrk persistence (DSH panel polls HTTP).
 */
export function syncAutoReviewSlashCommand(
  options: AutoReviewOptions,
  args: string,
): void {
  const action = parseAutoReviewSlashInput(args);
  if (!action) return;
  if (action.kind === "enable") {
    setEnabled(options, true);
    return;
  }
  if (action.kind === "disable") {
    setEnabled(options, false);
    return;
  }
  const stats = loadStats(options);
  if (action.index < 0 || action.index >= stats.recentDenies.length) return;
  saveStats(options, {
    ...stats,
    recentDenies: stats.recentDenies.filter((_, i) => i !== action.index),
    allows: stats.allows + 1,
  });
}
