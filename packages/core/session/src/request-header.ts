/**
 * DSH `request/header` fold — reconstruct the active LLM route from session log.
 */
import type {
  LlmRequestConfig,
  RequestHeaderEvent,
  RequestHeaderToolSchema,
  SessionEvent,
} from "@xrkseek/protocol";

export interface RequestHeaderSnapshot {
  readonly config: LlmRequestConfig;
  readonly system?: string;
  readonly tools?: readonly RequestHeaderToolSchema[];
  readonly adapterDefaults?: {
    readonly reasoningEffort?: boolean;
    readonly maxTokens?: boolean;
  };
}

export function llmConfigEquals(
  a: LlmRequestConfig,
  b: LlmRequestConfig,
): boolean {
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    a.reasoningEffort === b.reasoningEffort &&
    a.contextWindow === b.contextWindow
  );
}

function toolsEqual(
  a: readonly RequestHeaderToolSchema[] | undefined,
  b: readonly RequestHeaderToolSchema[] | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Route + standing tools + adapterDefaults (ignores assembled `system` text). */
export function requestHeaderRouteEquals(
  a: RequestHeaderSnapshot,
  b: RequestHeaderSnapshot,
): boolean {
  if (!llmConfigEquals(a.config, b.config)) return false;
  if (!toolsEqual(a.tools, b.tools)) return false;
  return (
    a.adapterDefaults?.reasoningEffort === b.adapterDefaults?.reasoningEffort &&
    a.adapterDefaults?.maxTokens === b.adapterDefaults?.maxTokens
  );
}

export function requestHeaderEquals(
  a: RequestHeaderSnapshot,
  b: RequestHeaderSnapshot,
): boolean {
  if (!requestHeaderRouteEquals(a, b)) return false;
  return (a.system ?? "") === (b.system ?? "");
}

/**
 * Latest canonical request envelope after folding header events.
 * Each `request/header` replaces the prior snapshot (not a patch), so the
 * newest wins — scan from the tail so a multi-million-event session does not
 * walk every assistant/tool chunk just to rediscover the last header.
 */
export function foldRequestHeader(
  events: readonly SessionEvent[],
): RequestHeaderSnapshot | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event !== undefined && event.type === "request/header") {
      return canonicalRequestHeader(event);
    }
  }
  return undefined;
}

export function canonicalRequestHeader(
  event: RequestHeaderEvent,
): RequestHeaderSnapshot {
  const { config, adapterDefaults, system, tools } = event.header;
  return {
    config: {
      provider: config.provider,
      model: config.model,
      ...(config.reasoningEffort !== undefined
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
      ...(config.contextWindow !== undefined
        ? { contextWindow: config.contextWindow }
        : {}),
    },
    ...(system !== undefined ? { system } : {}),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(adapterDefaults && Object.keys(adapterDefaults).length > 0
      ? { adapterDefaults }
      : {}),
  };
}
