/**
 * Shared honest JSON envelopes for dsh-compat underlying modules.
 * Adapter/stub layers should compose these instead of ad-hoc incomplete tags.
 *
 * Prefer `hostIncomplete` / `tag` at call sites for one-off gaps; keep only
 * envelopes that have live product paths here.
 */
import { DSH_COMPAT_ADAPTER, hostIncomplete, tag } from "./meta.js";

export function honestReady(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return tag({
    ok: true,
    status: "ready",
    writable: true,
    ...extra,
  });
}

/** Cordis Host feature action that cannot run without fiber (tags `feature-host`). */
export function honestHostActionUnavailable(
  feature: string,
  endpoint: string,
  message?: string,
): Record<string, unknown> {
  return hostIncomplete(feature, {
    ok: false,
    code: "HOST_UNAVAILABLE",
    message:
      message ??
      `Cordis ${feature} host is not embedded on XRK-Harness`,
    endpoint,
  });
}

/** IM tunnel actions — always tags `im-host`. */
export function imHostActionUnavailable(
  channel: string,
  endpoint: string,
  message?: string,
): Record<string, unknown> {
  return tag(
    {
      ok: false,
      code: "IM_HOST_UNAVAILABLE",
      message:
        message ??
        `${channel} IM tunnel is not embedded on XRK-Harness`,
      endpoint,
      channel,
    },
    ["im-host"],
  );
}

/** Vision analysis / screenshot hosts — tags `vision-host`. */
export function visionHostUnavailable(
  endpoint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("vision", {
    ok: false,
    code: "VISION_HOST_UNAVAILABLE",
    message: "Vision analysis host is not embedded on XRK-Harness",
    endpoint,
    ...extra,
  });
}

/**
 * Legacy envelope for a caller that still wants the `auto-review-host` tag.
 * Classify itself uses {@link classifyAutoReview} (heuristic, plugin, or HTTP).
 */
export function autoReviewClassifierUnavailable(
  endpoint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("auto-review", {
    ok: false,
    code: "CLASSIFIER_HOST_UNAVAILABLE",
    message: "Auto-review classifier was not invoked; use the classifier seam instead",
    endpoint,
    ...extra,
  });
}

/**
 * Unknown Mnemon RPCs (not the document engine). Tags `mnemon-host`.
 * search / graph / bodies are served by `queryMnemonEngine` instead.
 */
export function mnemonEngineUnavailable(
  endpoint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("mnemon", {
    ok: true,
    endpoint,
    items: [],
    note: "Unknown Mnemon RPC; document search / graph / bodies are served in-process.",
    ...extra,
  });
}

export function adapterEcho(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { adapter: DSH_COMPAT_ADAPTER, ...extra };
}
