/**
 * DSH `request/header` fold — reconstruct the active LLM route from session log.
 */
import type { LlmRequestConfig, RequestHeaderEvent, SessionEvent } from "@xrkseek/protocol";

export interface RequestHeaderSnapshot {
  readonly config: LlmRequestConfig;
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
    a.reasoningEffort === b.reasoningEffort
  );
}

export function requestHeaderEquals(
  a: RequestHeaderSnapshot,
  b: RequestHeaderSnapshot,
): boolean {
  if (!llmConfigEquals(a.config, b.config)) return false;
  return (
    a.adapterDefaults?.reasoningEffort === b.adapterDefaults?.reasoningEffort &&
    a.adapterDefaults?.maxTokens === b.adapterDefaults?.maxTokens
  );
}

/** Latest canonical request envelope after folding header events. */
export function foldRequestHeader(
  events: readonly SessionEvent[],
): RequestHeaderSnapshot | undefined {
  let state: RequestHeaderSnapshot | undefined;
  for (const event of events) {
    if (event.type === "request/header") {
      state = canonicalRequestHeader(event);
    }
  }
  return state;
}

export function canonicalRequestHeader(
  event: RequestHeaderEvent,
): RequestHeaderSnapshot {
  const { config, adapterDefaults } = event.header;
  return {
    config: {
      provider: config.provider,
      model: config.model,
      ...(config.reasoningEffort !== undefined
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
    },
    ...(adapterDefaults && Object.keys(adapterDefaults).length > 0
      ? { adapterDefaults }
      : {}),
  };
}
