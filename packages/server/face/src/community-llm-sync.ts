/**
 * Merge community Cordis LLM catalog rows into Face `llm-pi-ai` models.
 *
 * Re-sync must keep user-edited capacities (`softBudgetMaxTokens`, `maxTokens`, …)
 * while refreshing id/name/context from the adapter catalog.
 */

/** Reasoning menu mirrored from Cordis resolveModel / catalog product rows. */
export interface CommunitySyncReasoning {
  readonly efforts: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
  }[];
  readonly defaultEffort?: string;
}

export interface CommunitySyncModelIn {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly softBudgetMaxTokens?: number;
  readonly inputModalities?: readonly ("text" | "image")[];
  readonly reasoning?: CommunitySyncReasoning;
}

export interface CommunitySyncModelOut {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly softBudgetMaxTokens?: number;
  readonly inputModalities?: readonly ("text" | "image")[];
  readonly reasoning?: CommunitySyncReasoning;
}

/**
 * Soft ceiling from context when the catalog omits one.
 * Floor 100k; otherwise 75% of the window (1k steps, cap 300k).
 * Windows under 100k stay at 75% (cannot raise the soft ceiling above the window).
 */
export function defaultSoftBudgetMaxTokens(
  contextWindow: number | undefined,
): number | undefined {
  if (
    typeof contextWindow !== "number" ||
    !Number.isFinite(contextWindow) ||
    contextWindow < 8_000
  ) {
    return undefined;
  }
  const pct = Math.floor((contextWindow * 0.75) / 1_000) * 1_000;
  const floored =
    contextWindow >= 100_000 ? Math.max(100_000, pct) : Math.max(8_000, pct);
  return Math.min(300_000, floored);
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function modalitiesOf(
  value: unknown,
): readonly ("text" | "image")[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mods = value
    .map((m) => String(m).trim())
    .filter((m): m is "text" | "image" => m === "text" || m === "image");
  return mods.length > 0 ? [...new Set(mods)] : undefined;
}

function reasoningOf(value: unknown): CommunitySyncReasoning | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const list = Array.isArray(o.efforts) ? o.efforts : undefined;
  if (!list || list.length === 0) return undefined;
  const efforts: { id: string; name: string; description?: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const name =
      typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
    const description =
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim()
        : undefined;
    efforts.push({
      id,
      name,
      ...(description !== undefined ? { description } : {}),
    });
  }
  if (efforts.length === 0) return undefined;
  const defaultRaw = o.defaultEffort;
  const defaultEffort =
    typeof defaultRaw === "string" &&
    defaultRaw.trim() &&
    efforts.some((effort) => effort.id === defaultRaw.trim())
      ? defaultRaw.trim()
      : undefined;
  return {
    efforts,
    ...(defaultEffort !== undefined ? { defaultEffort } : {}),
  };
}

/**
 * Community Cordis LLM providers that publish an ephemeral loopback OpenAI
 * shim/forward. Their Face `baseURL`s must not collide (WB CN vs OFM).
 */
export const COMMUNITY_LOOPBACK_LLM_PROVIDERS = [
  "workbuddy",
  "workbuddy-ai",
  "our-free-model",
  "our-free-model-region",
] as const;

export type CommunityLoopbackLlmProviderId =
  (typeof COMMUNITY_LOOPBACK_LLM_PROVIDERS)[number];

export function isCommunityLoopbackLlmProvider(
  providerId: string,
): providerId is CommunityLoopbackLlmProviderId {
  return (COMMUNITY_LOOPBACK_LLM_PROVIDERS as readonly string[]).includes(
    providerId,
  );
}

/**
 * When syncing a community loopback provider, refuse a `baseURL` already owned
 * by another community loopback row (stale port after OFM/WB listen reshuffle).
 * @returns colliding provider id, or `undefined` when safe.
 */
export function communityLoopbackBaseUrlCollision(
  providerId: string,
  baseUrl: string,
  llmPiAiValue: unknown,
): string | undefined {
  if (!isCommunityLoopbackLlmProvider(providerId)) return undefined;
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) return undefined;
  if (!llmPiAiValue || typeof llmPiAiValue !== "object") return undefined;
  const providers = (llmPiAiValue as { providers?: unknown }).providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return undefined;
  }
  for (const [otherId, row] of Object.entries(
    providers as Record<string, unknown>,
  )) {
    const id = otherId.trim().toLowerCase();
    if (!id || id === providerId || !isCommunityLoopbackLlmProvider(id)) {
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const otherBase = (row as { baseURL?: unknown }).baseURL;
    if (typeof otherBase !== "string" || !otherBase.trim()) continue;
    if (otherBase.trim().replace(/\/+$/, "") === normalized) return id;
  }
  return undefined;
}

/** Existing `llm-pi-ai.providers.<id>` row from Face settings (merged layers). */
export function existingPiAiProvider(
  llmPiAiValue: unknown,
  providerId: string,
): Record<string, unknown> | undefined {
  if (!llmPiAiValue || typeof llmPiAiValue !== "object") return undefined;
  const providers = (llmPiAiValue as { providers?: unknown }).providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return undefined;
  }
  const row = (providers as Record<string, unknown>)[providerId];
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  return row as Record<string, unknown>;
}

/**
 * @param incoming - adapter catalog rows (WorkBuddy · OFM · …).
 * @param previousModels - existing `providers.<id>.models` from Face settings.
 */
export function mergeCommunityProviderModels(
  incoming: readonly CommunitySyncModelIn[],
  previousModels: unknown,
): CommunitySyncModelOut[] {
  const prevById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(previousModels)) {
    for (const row of previousModels) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const id = (row as { id?: unknown }).id;
      if (typeof id !== "string" || !id.trim()) continue;
      prevById.set(id.trim(), row as Record<string, unknown>);
    }
  }

  return incoming.map((m) => {
    const prev = prevById.get(m.id);
    const contextWindow =
      positiveInt(m.contextWindow) ?? positiveInt(prev?.contextWindow);
    const maxTokens = positiveInt(m.maxTokens) ?? positiveInt(prev?.maxTokens);
    // User-edited soft budget wins over catalog / derived defaults.
    const softBudgetMaxTokens =
      positiveInt(prev?.softBudgetMaxTokens) ??
      positiveInt(m.softBudgetMaxTokens) ??
      defaultSoftBudgetMaxTokens(contextWindow);
    const inputModalities =
      modalitiesOf(m.inputModalities) ?? modalitiesOf(prev?.inputModalities);
    const name =
      typeof m.name === "string" && m.name.trim()
        ? m.name.trim()
        : typeof prev?.name === "string" && prev.name.trim()
          ? prev.name.trim()
          : undefined;
    // Fresh catalog reasoning wins; keep previous when the adapter omitted it.
    const reasoning = reasoningOf(m.reasoning) ?? reasoningOf(prev?.reasoning);

    return {
      id: m.id,
      ...(name ? { name } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(softBudgetMaxTokens !== undefined ? { softBudgetMaxTokens } : {}),
      ...(inputModalities ? { inputModalities } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    };
  });
}
