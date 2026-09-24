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
    recentDenies: stats.recentDenies,
    note:
      classifier.kind === "heuristic"
        ? "Default heuristic classifier. Replace via Settings → Plugins → Advanced, options.classifier, or XRK_AUTO_REVIEW_CLASSIFIER_URL."
        : `Classifier seam active (${classifier.kind}).`,
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
        ? "Classifier seam. Default is the heuristic; plugin or HTTP may replace it."
        : "Classifier failed closed (ask).",
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
