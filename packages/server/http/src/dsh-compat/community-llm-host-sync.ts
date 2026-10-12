/**
 * Shared Face `syncCommunityLlmProvider` helpers for Cordis community LLM hosts
 * (OFM, WorkBuddy, …).
 */

export interface CommunityLlmSyncModelRow {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly softBudgetMaxTokens?: number;
  readonly inputModalities?: readonly ("text" | "image")[];
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
    });
  }
  return out;
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
