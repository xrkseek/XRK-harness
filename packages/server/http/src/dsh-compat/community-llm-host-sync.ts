/**
 * Shared Face `syncCommunityLlmProvider` helpers for Cordis community LLM hosts
 * (OFM, WorkBuddy, …).
 */

/** Selectable reasoning levels carried into Face `llm-pi-ai` / ModelSelect. */
export interface CommunityLlmSyncReasoning {
  readonly efforts: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
  }[];
  readonly defaultEffort?: string;
}

export interface CommunityLlmSyncModelRow {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly softBudgetMaxTokens?: number;
  readonly inputModalities?: readonly ("text" | "image")[];
  /** Thinking intensity menu when the adapter advertises one (not DeepSeek-only). */
  readonly reasoning?: CommunityLlmSyncReasoning;
}

/** Parse adapter / settings reasoning shapes into Face ModelSelect form. */
export function reasoningFromUnknown(
  raw: unknown,
): CommunityLlmSyncReasoning | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;

  // DSH / Cordis resolveModel: { reasoning: { efforts, defaultEffort } }
  const nested = o.reasoning;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const fromNested = reasoningFromEffortsBlob(nested as Record<string, unknown>);
    if (fromNested) return fromNested;
  }

  // DSH pi-ai profile: reasoningEfforts: { off: null, high: "high" } (dict)
  // or string[] + defaultReasoningEffort. false = non-reasoning model.
  if (o.reasoningEfforts === false) return undefined;
  if (
    o.reasoningEfforts &&
    typeof o.reasoningEfforts === "object" &&
    !Array.isArray(o.reasoningEfforts)
  ) {
    const fromDict = reasoningFromEffortsDict(
      o.reasoningEfforts as Record<string, unknown>,
      o,
    );
    if (fromDict) return fromDict;
  }

  // pi-ai materialized model: thinkingLevelMap (null = unsupported)
  if (
    o.thinkingLevelMap &&
    typeof o.thinkingLevelMap === "object" &&
    !Array.isArray(o.thinkingLevelMap)
  ) {
    const fromMap = reasoningFromThinkingLevelMap(
      o.thinkingLevelMap as Record<string, unknown>,
      o,
    );
    if (fromMap) return fromMap;
  }

  // Catalog product rows: reasoningEfforts: string[] + defaultReasoningEffort
  if (Array.isArray(o.reasoningEfforts) || Array.isArray(o.efforts)) {
    return reasoningFromEffortsBlob(o);
  }

  return undefined;
}

/** DSH `reasoningEfforts` dict — keys are offered levels (values are wire ids). */
function reasoningFromEffortsDict(
  dict: Record<string, unknown>,
  meta: Record<string, unknown>,
): CommunityLlmSyncReasoning | undefined {
  const efforts: { id: string; name: string }[] = [];
  for (const [rawId, wire] of Object.entries(dict)) {
    const id = rawId.trim();
    if (!id || wire === false) continue;
    efforts.push({ id, name: effortDisplayName(id) });
  }
  if (efforts.length === 0) return undefined;
  return withDefaultEffort(efforts, meta);
}

/** pi-ai `thinkingLevelMap` — `null` means level not offered. */
function reasoningFromThinkingLevelMap(
  map: Record<string, unknown>,
  meta: Record<string, unknown>,
): CommunityLlmSyncReasoning | undefined {
  const efforts: { id: string; name: string }[] = [];
  for (const [rawId, wire] of Object.entries(map)) {
    const id = rawId.trim();
    if (!id || wire === null || wire === false) continue;
    efforts.push({ id, name: effortDisplayName(id) });
  }
  // Declared `off: null` in reasoningEfforts is omitted from the map but still
  // offered — when reasoning is on and "off" is absent from the map entirely,
  // DSH still lists off. If the map only has nulls for undeclared levels,
  // keys with string wire values are the explicit menu.
  if (efforts.length === 0) return undefined;
  if (
    !efforts.some((e) => e.id === "off") &&
    Object.prototype.hasOwnProperty.call(map, "off") === false &&
    meta.reasoning === true
  ) {
    efforts.unshift({ id: "off", name: "Off" });
  }
  return withDefaultEffort(efforts, meta);
}

function withDefaultEffort(
  efforts: { id: string; name: string; description?: string }[],
  meta: Record<string, unknown>,
): CommunityLlmSyncReasoning {
  const defaultRaw =
    meta.defaultEffort ?? meta.defaultReasoningEffort ?? meta.default;
  const defaultEffort =
    typeof defaultRaw === "string" && defaultRaw.trim()
      ? defaultRaw.trim()
      : undefined;
  const defaultOk =
    defaultEffort !== undefined &&
    efforts.some((effort) => effort.id === defaultEffort)
      ? defaultEffort
      : undefined;
  return {
    efforts,
    ...(defaultOk !== undefined ? { defaultEffort: defaultOk } : {}),
  };
}

function reasoningFromEffortsBlob(
  o: Record<string, unknown>,
): CommunityLlmSyncReasoning | undefined {
  const list = Array.isArray(o.efforts)
    ? o.efforts
    : Array.isArray(o.reasoningEfforts)
      ? o.reasoningEfforts
      : undefined;
  if (!list || list.length === 0) return undefined;

  const efforts: { id: string; name: string; description?: string }[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      const id = item.trim();
      efforts.push({ id, name: effortDisplayName(id) });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const name =
      typeof row.name === "string" && row.name.trim()
        ? row.name.trim()
        : effortDisplayName(id);
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
  return withDefaultEffort(efforts, o);
}

function effortDisplayName(id: string): string {
  if (!id) return id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Normalize adapter `listModels` rows for Face merge. */
export function asCommunityLlmModelRows(
  raw: readonly unknown[],
): CommunityLlmSyncModelRow[] {
  const out: CommunityLlmSyncModelRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id.trim()) continue;
    const modalities: ("text" | "image")[] = ["text"];
    const input = o.input ?? o.inputModalities;
    if (
      o.supportsImages === true ||
      o.vision === true ||
      (Array.isArray(input) && input.includes("image"))
    ) {
      modalities.push("image");
    }
    const context =
      typeof o.contextWindow === "number"
        ? o.contextWindow
        : typeof (o.context as { contextWindow?: unknown } | undefined)
              ?.contextWindow === "number"
          ? (o.context as { contextWindow: number }).contextWindow
          : undefined;
    const reasoning = reasoningFromUnknown(o);
    out.push({
      id: o.id.trim(),
      ...(typeof o.name === "string" ? { name: o.name } : {}),
      ...(typeof context === "number" && Number.isFinite(context)
        ? { contextWindow: context }
        : {}),
      ...(typeof o.maxTokens === "number" && Number.isFinite(o.maxTokens)
        ? { maxTokens: o.maxTokens }
        : {}),
      ...(typeof o.softBudgetMaxTokens === "number" &&
      Number.isFinite(o.softBudgetMaxTokens)
        ? { softBudgetMaxTokens: o.softBudgetMaxTokens }
        : {}),
      inputModalities: modalities,
      ...(reasoning !== undefined ? { reasoning } : {}),
    });
  }
  return out;
}

/**
 * DSH catalog fills efforts via `resolveModelInfo`; many Cordis adapters only
 * put reasoning on `resolveModel`, not `listModels`. Enrich listed rows when
 * the adapter exposes resolve.
 */
export async function enrichCommunityModelsWithResolve(
  adapter: {
    resolveModel?: (provider: string, model: string) => Promise<unknown>;
  },
  providerId: string,
  rows: readonly CommunityLlmSyncModelRow[],
): Promise<CommunityLlmSyncModelRow[]> {
  if (typeof adapter.resolveModel !== "function" || rows.length === 0) {
    return [...rows];
  }
  const resolve = adapter.resolveModel.bind(adapter);
  return Promise.all(
    rows.map(async (row) => {
      if (row.reasoning !== undefined) return row;
      try {
        const info = await resolve(providerId, row.id);
        const reasoning = reasoningFromUnknown(info);
        if (reasoning === undefined) return row;
        const context =
          row.contextWindow ??
          (info &&
          typeof info === "object" &&
          typeof (info as { context?: { contextWindow?: unknown } }).context
            ?.contextWindow === "number"
            ? (info as { context: { contextWindow: number } }).context
                .contextWindow
            : undefined);
        const maxTokens =
          row.maxTokens ??
          (info &&
          typeof info === "object" &&
          typeof (info as { defaultMaxTokens?: unknown }).defaultMaxTokens ===
            "number"
            ? (info as { defaultMaxTokens: number }).defaultMaxTokens
            : undefined);
        return {
          ...row,
          ...(context !== undefined ? { contextWindow: context } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          reasoning,
        };
      } catch {
        return row;
      }
    }),
  );
}

/** First non-empty `baseUrl` on adapter model rows (loopback / catalog). */
export function baseUrlFromCommunityModels(
  models: readonly unknown[],
): string | undefined {
  for (const row of models) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const u = (row as { baseUrl?: unknown }).baseUrl;
    if (typeof u === "string" && u.trim()) {
      return u.trim().replace(/\/+$/, "");
    }
  }
  return undefined;
}

/** Catalog/shim often lag `registerAdapter`; retry until Face sync sticks. */
const SYNC_RETRY_MS = [0, 300, 1_000, 3_000, 8_000, 20_000] as const;

export function scheduleCommunityLlmSyncRetries(
  runAll: () => Promise<void>,
  isDisposed: () => boolean,
): void {
  for (const delay of SYNC_RETRY_MS) {
    const timer = setTimeout(() => {
      if (isDisposed()) return;
      void runAll();
    }, delay);
    timer.unref?.();
  }
}

/** Face sync fingerprint (provider · loopback · model ids · effort menus). */
export function communityLlmSyncFingerprint(
  providerId: string,
  baseUrl: string,
  models: readonly CommunityLlmSyncModelRow[],
): string {
  return `${providerId}|${baseUrl}|${models
    .map(
      (m) =>
        `${m.id}:${m.reasoning?.efforts.map((e) => e.id).join("/") ?? ""}`,
    )
    .join(",")}|c2`;
}

/** Drop stale fingerprints for a provider when its loopback port moves. */
export function dropStaleCommunityLlmFingerprints(
  fingerprints: Set<string>,
  providerId: string,
  baseUrl: string,
): void {
  const keepPrefix = `${providerId}|${baseUrl}|`;
  const providerPrefix = `${providerId}|`;
  for (const fp of [...fingerprints]) {
    if (fp.startsWith(providerPrefix) && !fp.startsWith(keepPrefix)) {
      fingerprints.delete(fp);
    }
  }
}

export type CommunityLlmSyncer = () => Promise<boolean>;

/**
 * Shared Face-sync batching for Cordis community LLM hosts (WB · OFM · …).
 * `settled` is true only after every registered syncer returns ok once.
 */
export function createCommunityLlmSyncScheduler(options: {
  readonly isDisposed: () => boolean;
  readonly onBatchError?: (error: unknown) => void;
}): {
  readonly fingerprints: Set<string>;
  readonly settled: () => boolean;
  markUnsettled(): void;
  addSyncer(sync: CommunityLlmSyncer): void;
  runAll(): Promise<void>;
  scheduleRetries(): void;
} {
  const syncers: CommunityLlmSyncer[] = [];
  const fingerprints = new Set<string>();
  let settled = false;
  let chain: Promise<void> = Promise.resolve();

  const runAll = async (): Promise<void> => {
    chain = chain
      .then(async () => {
        if (options.isDisposed()) return;
        let allOk = syncers.length > 0;
        for (const sync of syncers) {
          if (!(await sync())) allOk = false;
        }
        if (allOk) settled = true;
      })
      .catch((error: unknown) => {
        options.onBatchError?.(error);
      });
    await chain;
  };

  return {
    fingerprints,
    settled: () => settled,
    markUnsettled() {
      settled = false;
    },
    addSyncer(sync) {
      syncers.push(sync);
      settled = false;
    },
    runAll,
    scheduleRetries() {
      scheduleCommunityLlmSyncRetries(runAll, options.isDisposed);
    },
  };
}
