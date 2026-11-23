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
    a.contextWindow === b.contextWindow &&
    a.softBudgetMaxTokens === b.softBudgetMaxTokens &&
    a.softBudgetKeepTokens === b.softBudgetKeepTokens &&
    a.softBudgetBufferTokens === b.softBudgetBufferTokens
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
 *
 * Scan from the tail. Each field is taken from the newest header that carries
 * it so a slim system-only `request/header` (no `tools`) keeps the prior
 * standing schemas — needed for cache-audit logging without rewriting ~100KB
 * tool JSON on every persona/time delta.
 */
export function foldRequestHeader(
  events: readonly SessionEvent[],
): RequestHeaderSnapshot | undefined {
  let config: LlmRequestConfig | undefined;
  let system: string | undefined;
  let tools: readonly RequestHeaderToolSchema[] | undefined;
  let adapterDefaults:
    | {
        readonly reasoningEffort?: boolean;
        readonly maxTokens?: boolean;
      }
    | undefined;
  let saw = false;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined || event.type !== "request/header") continue;
    saw = true;
    const h = canonicalRequestHeader(event);
    if (config === undefined) config = h.config;
    if (system === undefined && h.system !== undefined) system = h.system;
    if (tools === undefined && h.tools !== undefined && h.tools.length > 0) {
      tools = h.tools;
    }
    if (adapterDefaults === undefined && h.adapterDefaults) {
      adapterDefaults = h.adapterDefaults;
    }
    // Common case: one full header → all fields on the first hit.
    if (config !== undefined && tools !== undefined) break;
  }
  if (!saw || config === undefined) return undefined;
  return {
    config,
    ...(system !== undefined ? { system } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(adapterDefaults !== undefined ? { adapterDefaults } : {}),
  };
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
      ...(config.softBudgetMaxTokens !== undefined
        ? { softBudgetMaxTokens: config.softBudgetMaxTokens }
        : {}),
      ...(config.softBudgetKeepTokens !== undefined
        ? { softBudgetKeepTokens: config.softBudgetKeepTokens }
        : {}),
      ...(config.softBudgetBufferTokens !== undefined
        ? { softBudgetBufferTokens: config.softBudgetBufferTokens }
        : {}),
    },
    ...(system !== undefined ? { system } : {}),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(adapterDefaults && Object.keys(adapterDefaults).length > 0
      ? { adapterDefaults }
      : {}),
  };
}
