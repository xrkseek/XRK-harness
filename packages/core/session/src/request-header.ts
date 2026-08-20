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

export function requestHeaderEquals(
  a: RequestHeaderSnapshot,
  b: RequestHeaderSnapshot,
): boolean {
  if (!llmConfigEquals(a.config, b.config)) return false;
  if ((a.system ?? "") !== (b.system ?? "")) return false;
  if (!toolsEqual(a.tools, b.tools)) return false;
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
