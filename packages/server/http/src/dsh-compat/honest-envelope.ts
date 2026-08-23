/**
 * Shared honest JSON envelopes for dsh-compat underlying modules.
 * Adapter/stub layers should compose these instead of ad-hoc incomplete tags.
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

/** Search execution against remote engines — tags `modsearch-host`. */
export function modsearchHostUnavailable(
  endpoint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("modsearch", {
    ok: false,
    code: "SEARCH_HOST_UNAVAILABLE",
    message: "Modsearch query host is not embedded on XRK-Harness",
    endpoint,
    ...extra,
  });
}

/** GenUI live preview/render — tags `genui-host`. */
export function genuiHostIncomplete(
  path: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("genui", {
    ok: true,
    path,
    note: "Design library is file-backed; Cordis GenUI render host is not embedded.",
    ...extra,
  });
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

/** Noema embedding runner — tags `noema-host`. */
export function noemaRunnerUnavailable(
  endpoint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("noema", {
    ok: false,
    code: "NOEMA_RUNNER_UNAVAILABLE",
    message: "Noema memory runner is not embedded on XRK-Harness",
    endpoint,
    ...extra,
  });
}

/** Pocket LAN tunnel — tags `pocket-host` when mobile-access off. */
export function pocketHostIncomplete(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("pocket", {
    ok: true,
    note: "Enable mobile-access for same-origin pocket on XRK.",
    ...extra,
  });
}

/** TongFlow Python studio scanner — tags `tongflow-host`. */
export function tongflowStudioUnavailable(
  endpoint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("tongflow", {
    ok: false,
    code: "STUDIO_HOST_UNAVAILABLE",
    message: "TongFlow Python studio engine is not embedded on XRK-Harness",
    endpoint,
    ...extra,
  });
}

/** dsh-auto-review LLM classifier — tags `auto-review-host`. */
export function autoReviewClassifierUnavailable(
  endpoint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return hostIncomplete("auto-review", {
    ok: false,
    code: "CLASSIFIER_HOST_UNAVAILABLE",
    message: "Auto-review classifier host is not embedded on XRK-Harness",
    endpoint,
    ...extra,
  });
}

export function adapterEcho(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { adapter: DSH_COMPAT_ADAPTER, ...extra };
}
