/**
 * dsh-auto-review — settings + stats persist under ~/.xrk; classifier stays honest.
 * Face `autoReview` projection handles session slash; HTTP serves DSH client panel polls.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { sendJson } from "./underlying/http-json.js";
import {
  autoReviewClassifierUnavailable,
  honestReady,
} from "./honest-envelope.js";
import { classifyAutoReviewHeuristic } from "./host-feature-bridge.js";
import { hostIncomplete } from "./meta.js";
import { createPersistedSettingsDocStore } from "./persisted-settings-store.js";
import { dshSettingsDefaults } from "./settings-defaults.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface AutoReviewOptions {
  readonly xrkHome?: string;
}

interface AutoReviewStats {
  allows: number;
  denies: number;
  verdictsUsed: number;
  failuresUsed: number;
  recentDenies: Array<{ reviewId: string; toolName: string }>;
}

const EMPTY_STATS: AutoReviewStats = {
  allows: 0,
  denies: 0,
  verdictsUsed: 0,
  failuresUsed: 0,
  recentDenies: [],
};

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
  return STATS_STORE.read(options.xrkHome).data;
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

function setEnabled(options: AutoReviewOptions, enabled: boolean): void {
  settingsStore(options).replaceUser({ enabled });
}

function statusPayload(options: AutoReviewOptions): Record<string, unknown> {
  const store = settingsStore(options);
  const stats = loadStats(options);
  return hostIncomplete("auto-review", {
    ok: true,
    enabled: isEnabled(options),
    status: isEnabled(options) ? "ready" : "offline",
    writable: true,
    settingsRevision: store.revision(),
    allows: stats.allows,
    denies: stats.denies,
    verdictsUsed: stats.verdictsUsed,
    failuresUsed: stats.failuresUsed,
    recentDenies: stats.recentDenies,
    note: "Toggle persists via autoReview settings; classifier host is not embedded on XRK.",
  });
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
    const stats = loadStats(options);
    if (index >= 0 && index < stats.recentDenies.length) {
      const recentDenies = stats.recentDenies.filter((_, i) => i !== index);
      saveStats(options, {
        ...stats,
        recentDenies,
        allows: stats.allows + 1,
      });
    }
    sendJson(res, 200, statusPayload(options));
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
      sendJson(res, 200, autoReviewClassifierUnavailable(sub, { enabled: false }));
      return true;
    }
    const verdict = classifyAutoReviewHeuristic(body);
    const stats = loadStats(options);
    if (verdict.verdict === "deny") {
      saveStats(options, {
        ...stats,
        denies: stats.denies + 1,
        verdictsUsed: stats.verdictsUsed + 1,
        recentDenies: [
          {
            reviewId: randomUUID(),
            toolName: String(body.toolName ?? body.name ?? "tool"),
          },
          ...stats.recentDenies,
        ].slice(0, 8),
      });
    } else if (verdict.verdict === "allow") {
      saveStats(options, {
        ...stats,
        allows: stats.allows + 1,
        verdictsUsed: stats.verdictsUsed + 1,
      });
    }
    sendJson(res, 200, {
      ok: true,
      ...verdict,
      classifier: "xrk-heuristic",
      adapter: "xrk-dsh-compat",
      note: "Heuristic classifier bridge — not upstream LLM classifier.",
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

/** Record a deny for HTTP stats (optional bridge from Face later). */
export function recordAutoReviewDeny(
  options: AutoReviewOptions,
  toolName: string,
): void {
  const stats = loadStats(options);
  saveStats(options, {
    ...stats,
    denies: stats.denies + 1,
    verdictsUsed: stats.verdictsUsed + 1,
    recentDenies: [
      { reviewId: randomUUID(), toolName },
      ...stats.recentDenies,
    ].slice(0, 8),
  });
}

/**
 * Mirror Face `/auto-review` slash into ~/.xrk persistence (DSH panel polls HTTP).
 */
export function syncAutoReviewSlashCommand(
  options: AutoReviewOptions,
  args: string,
): void {
  const input = args.trim();
  if (input === "on" || input === "") {
    setEnabled(options, true);
    return;
  }
  if (input === "off") {
    setEnabled(options, false);
    return;
  }
  const approve = /^approve(?:\s+(\d+))?$/u.exec(input);
  if (!approve) return;
  const index = Number(approve[1] ?? "1") - 1;
  const stats = loadStats(options);
  if (index < 0 || index >= stats.recentDenies.length) return;
  saveStats(options, {
    ...stats,
    recentDenies: stats.recentDenies.filter((_, i) => i !== index),
    allows: stats.allows + 1,
  });
}
