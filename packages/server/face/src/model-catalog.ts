/**
 * Model catalog + shared default selection (DSH `agent-default-model` parity).
 */
import type { BrandEntry } from "@xrkseek/llm-registry";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { DEFAULT_DEEPSEEK_MODELS } from "./settings-schemas.js";
import { mergeLayers, persistSettingsDocument } from "./settings-document.js";
import { lastRequestHeaderSelection } from "./adapt/model-route.js";
import {
  listDeclaredPiAiProviders,
  piAiProviderProfile,
  providerHasUsableCredential,
  providerRouteServed,
  resolveProviderBinding,
} from "./llm-provider-context.js";

/** Selectable reasoning levels for one catalog model (composer ModelSelect). */
export interface FaceModelReasoning {
  readonly efforts: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
  }[];
  readonly defaultEffort?: string;
}

export interface FaceModelEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindow?: number;
  /** Soft-budget proactive compact ceiling (orthogonal to contextWindow). */
  readonly softBudgetMaxTokens?: number;
  readonly softBudgetKeepTokens?: number;
  readonly softBudgetBufferTokens?: number;
  /** Declared intake modalities (Settings-editable; adapter may still gate). */
  readonly inputModalities?: readonly ("text" | "image")[];
  /** DeepSeek-style thinking intensity when the route exposes it. */
  readonly reasoning?: FaceModelReasoning;
}

/** Wire efforts for official DeepSeek chat (`thinking` / `reasoning_effort`). */
const DEEPSEEK_REASONING_EFFORTS: FaceModelReasoning["efforts"] = [
  { id: "off", name: "Off" },
  { id: "low", name: "Low" },
  { id: "high", name: "High" },
  { id: "max", name: "Max" },
];

const DEEPSEEK_REASONING_IDS = new Set(
  DEEPSEEK_REASONING_EFFORTS.map((effort) => effort.id),
);

export interface FaceModelProviderGroup {
  readonly id: string;
  readonly name: string;
  readonly models: readonly FaceModelEntry[];
}

export interface FaceModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

function mergedNamespace(
  runtime: FaceRuntime,
  ns: string,
): Record<string, unknown> {
  const slot = runtime.settingsNamespaces.ensure(ns);
  return mergeLayers(
    slot.base,
    slot.user,
  );
}

function positiveIntField(
  row: object,
  key: string,
): number | undefined {
  const raw = (row as Record<string, unknown>)[key];
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  return undefined;
}

/** Buffer may be 0 (no headroom). */
function nonNegIntField(
  row: object,
  key: string,
): number | undefined {
  const raw = (row as Record<string, unknown>)[key];
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  return undefined;
}

/** Settings / sync row → Face reasoning (community + hand-edited pi-ai). */
function reasoningFromRow(row: object): FaceModelReasoning | undefined {
  const o = row as Record<string, unknown>;
  const nested = o.reasoning;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : o;

  // DSH pi-ai YAML: reasoningEfforts: { off: null, high: "high" }
  if (source.reasoningEfforts === false) return undefined;
  if (
    source.reasoningEfforts &&
    typeof source.reasoningEfforts === "object" &&
    !Array.isArray(source.reasoningEfforts)
  ) {
    const efforts: FaceModelReasoning["efforts"][number][] = [];
    for (const [rawId, wire] of Object.entries(
      source.reasoningEfforts as Record<string, unknown>,
    )) {
      const id = rawId.trim();
      if (!id || wire === false) continue;
      efforts.push({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
      });
    }
    if (efforts.length === 0) return undefined;
    return withRowDefaultEffort(efforts, source);
  }

  const list = Array.isArray(source.efforts)
    ? source.efforts
    : Array.isArray(source.reasoningEfforts)
      ? source.reasoningEfforts
      : undefined;
  if (!list || list.length === 0) return undefined;
  const efforts: FaceModelReasoning["efforts"][number][] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      const id = item.trim();
      efforts.push({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
      });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const effort = item as Record<string, unknown>;
    const id = typeof effort.id === "string" ? effort.id.trim() : "";
    if (!id) continue;
    const name =
      typeof effort.name === "string" && effort.name.trim()
        ? effort.name.trim()
        : id;
    const description =
      typeof effort.description === "string" && effort.description.trim()
        ? effort.description.trim()
        : undefined;
    efforts.push({
      id,
      name,
      ...(description !== undefined ? { description } : {}),
    });
  }
  if (efforts.length === 0) return undefined;
  return withRowDefaultEffort(efforts, source);
}

function withRowDefaultEffort(
  efforts: FaceModelReasoning["efforts"][number][],
  source: Record<string, unknown>,
): FaceModelReasoning {
  const defaultRaw =
    source.defaultEffort ?? source.defaultReasoningEffort;
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

function asModelRows(raw: unknown): FaceModelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FaceModelEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = String((row as { id?: unknown }).id ?? "").trim();
    if (!id) continue;
    const nameRaw = (row as { name?: unknown }).name;
    const name =
      typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : id;
    const descRaw = (row as { description?: unknown }).description;
    const contextWindow = positiveIntField(row, "contextWindow");
    const softBudgetMaxTokens = positiveIntField(row, "softBudgetMaxTokens");
    const softBudgetKeepTokens = positiveIntField(row, "softBudgetKeepTokens");
    const softBudgetBufferTokens = nonNegIntField(
      row,
      "softBudgetBufferTokens",
    );
    const modsRaw = (row as { inputModalities?: unknown }).inputModalities;
    const inputModalities = Array.isArray(modsRaw)
      ? modsRaw
          .map((m) => String(m).trim())
          .filter((m): m is "text" | "image" => m === "text" || m === "image")
      : undefined;
    const reasoning = reasoningFromRow(row);
    out.push({
      id,
      name,
      ...(typeof descRaw === "string" && descRaw.trim()
        ? { description: descRaw.trim() }
        : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(softBudgetMaxTokens !== undefined ? { softBudgetMaxTokens } : {}),
      ...(softBudgetKeepTokens !== undefined ? { softBudgetKeepTokens } : {}),
      ...(softBudgetBufferTokens !== undefined
        ? { softBudgetBufferTokens }
        : {}),
      ...(inputModalities && inputModalities.length > 0
        ? { inputModalities: [...new Set(inputModalities)] }
        : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    });
  }
  return out;
}

/** Settings `llm-deepseek.reasoningEffort` when valid; else High. */
function deepseekReasoning(runtime: FaceRuntime): FaceModelReasoning {
  const merged = mergedNamespace(runtime, "llm-deepseek");
  const raw = merged.reasoningEffort;
  const defaultEffort =
    typeof raw === "string" && DEEPSEEK_REASONING_IDS.has(raw) ? raw : "high";
  return {
    efforts: DEEPSEEK_REASONING_EFFORTS.map((effort) => ({ ...effort })),
    defaultEffort,
  };
}

function withDeepseekReasoning(
  models: readonly FaceModelEntry[],
  reasoning: FaceModelReasoning,
): FaceModelEntry[] {
  return models.map((model) =>
    model.reasoning === undefined ? { ...model, reasoning } : model,
  );
}

function deepseekModels(runtime: FaceRuntime): FaceModelEntry[] {
  const merged = mergedNamespace(runtime, "llm-deepseek");
  const reasoning = deepseekReasoning(runtime);
  const fromSettings = asModelRows(merged.models);
  if (fromSettings.length > 0) return withDeepseekReasoning(fromSettings, reasoning);
  return withDeepseekReasoning(
    DEFAULT_DEEPSEEK_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
      ...(m.softBudgetMaxTokens
        ? { softBudgetMaxTokens: m.softBudgetMaxTokens }
        : {}),
      ...(m.inputModalities ? { inputModalities: m.inputModalities } : {}),
    })),
    reasoning,
  );
}

function piAiProviderModels(
  runtime: FaceRuntime,
  brandId: string,
): FaceModelEntry[] {
  const profile = piAiProviderProfile(runtime, brandId);
  if (!profile) return [];
  return asModelRows(profile.models);
}

function modelsForBrand(
  runtime: FaceRuntime,
  brand: BrandEntry,
): FaceModelEntry[] {
  if (brand.id === "deepseek") return deepseekModels(runtime);
  const configured = piAiProviderModels(runtime, brand.id);
  if (configured.length > 0) return configured;
  // Seed defaultModel only when a profile already exists for this brand.
  if (brand.defaultModel && piAiProviderProfile(runtime, brand.id)) {
    return [{ id: brand.defaultModel, name: brand.defaultModel }];
  }
  return [];
}

/** Alias of {@link providerRouteServed} (DSH name kept for handlers). */
export function routeServed(runtime: FaceRuntime, provider: string): boolean {
  return providerRouteServed(runtime, provider);
}

/** Provider-grouped catalog for composer + `llm.models` (no `"default"` placeholders). */
export function buildFaceModelCatalog(
  runtime: FaceRuntime,
): { groups: FaceModelProviderGroup[]; failures: [] } {
  const groups: FaceModelProviderGroup[] = [];
  for (const brand of runtime.registry.listBrands()) {
    if (brand.id === "deepseek") {
      const models = deepseekModels(runtime);
      if (models.length === 0) continue;
      groups.push({ id: brand.id, name: brand.displayName, models });
      continue;
    }
    if (!brand.baseUrl && brand.id !== "ollama") continue;
    if (!piAiProviderProfile(runtime, brand.id)) continue;
    const models = modelsForBrand(runtime, brand);
    if (models.length === 0) continue;
    groups.push({
      id: brand.id,
      name: brand.displayName,
      models,
    });
  }
  for (const declared of listDeclaredPiAiProviders(runtime)) {
    if (!declared.baseUrl || declared.models.length === 0) continue;
    // Re-read profile models so reasoning / soft-budget fields survive
    // (DeclaredPiAiProvider.models is a thinner inventory shape).
    const models = asModelRows(piAiProviderProfile(runtime, declared.id)?.models);
    if (models.length === 0) continue;
    groups.push({
      id: declared.id,
      name: declared.displayName,
      models,
    });
  }
  return { groups, failures: [] };
}

/** Look up catalog contextWindow for a selection (Face contextPressure denominator). */
export function lookupModelContextWindow(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): number | undefined {
  return findCatalogModel(runtime, selection)?.contextWindow;
}

/** Soft-budget fields from the catalog row for the active selection. */
export function lookupModelSoftBudget(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): {
  readonly softBudgetMaxTokens?: number;
  readonly softBudgetKeepTokens?: number;
  readonly softBudgetBufferTokens?: number;
} {
  const m = findCatalogModel(runtime, selection);
  if (!m) return {};
  return {
    ...(m.softBudgetMaxTokens !== undefined
      ? { softBudgetMaxTokens: m.softBudgetMaxTokens }
      : {}),
    ...(m.softBudgetKeepTokens !== undefined
      ? { softBudgetKeepTokens: m.softBudgetKeepTokens }
      : {}),
    ...(m.softBudgetBufferTokens !== undefined
      ? { softBudgetBufferTokens: m.softBudgetBufferTokens }
      : {}),
  };
}

/** Catalog-declared intake modalities for a selection (adapter create extras). */
export function lookupModelInputModalities(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): readonly ("text" | "image")[] | undefined {
  return findCatalogModel(runtime, selection)?.inputModalities;
}

function findCatalogModel(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): FaceModelEntry | undefined {
  const brand = runtime.registry
    .listBrands()
    .find((b) => b.id === selection.provider);
  if (!brand) {
    if (selection.provider === "deepseek") {
      return deepseekModels(runtime).find((m) => m.id === selection.model);
    }
    return piAiProviderModels(runtime, selection.provider).find(
      (m) => m.id === selection.model,
    );
  }
  return modelsForBrand(runtime, brand).find((m) => m.id === selection.model);
}

/** Shared default from `agent-default-model` settings namespace. */
export function resolveAgentDefaultModel(
  runtime: FaceRuntime,
): FaceModelSelection | undefined {
  const merged = mergedNamespace(runtime, "agent-default-model");
  const provider = String(merged.provider ?? "").trim();
  const model = String(merged.model ?? "").trim();
  if (!provider || !model) return undefined;
  const effortRaw = merged.reasoningEffort;
  return {
    provider,
    model,
    ...(typeof effortRaw === "string" && effortRaw.trim()
      ? { reasoningEffort: effortRaw.trim() }
      : {}),
  };
}

/**
 * Resolve current selection: session override → last `request/header` in the
 * log → saved Settings default → first routable catalog row.
 * Catalog / default must not replace a route the session already ran.
 */
export function resolveSessionModelSelection(
  runtime: FaceRuntime,
  sessionId: string,
): FaceModelSelection {
  const override = runtime.sessionModels.get(sessionId);
  if (override) return override;

  if (sessionId && runtime.store.has(sessionId)) {
    const fromLog = lastRequestHeaderSelection(
      readSessionEvents(runtime.store, sessionId),
    );
    if (fromLog) return fromLog;
  }

  const saved = resolveAgentDefaultModel(runtime);
  if (saved) {
    try {
      resolveProviderBinding(runtime, {
        provider: saved.provider,
        model: saved.model,
      });
      return saved;
    } catch {
      /* fall through */
    }
  }

  const credentialed = runtime.registry
    .listBrands()
    .filter(
      (b) =>
        (b.baseUrl || b.id === "ollama") &&
        providerHasUsableCredential(runtime, b.id) &&
        routeServed(runtime, b.id),
    );
  for (const brand of credentialed) {
    const { groups } = buildFaceModelCatalog(runtime);
    const group = groups.find((g) => g.id === brand.id);
    const first = group?.models[0];
    if (first) return { provider: brand.id, model: first.id };
    if (brand.defaultModel) {
      return { provider: brand.id, model: brand.defaultModel };
    }
  }

  const deepseek = deepseekModels(runtime)[0];
  if (deepseek) return { provider: "deepseek", model: deepseek.id };
  return { provider: "deepseek", model: "deepseek-flash" };
}

/**
 * Copy the source session's effective route onto `toId` (in-memory only).
 * New Session uses this so a conversation that never called `selectModel`
 * still lands the composer on the same provider/model Status already shows.
 */
export function pinInheritedSessionModel(
  runtime: FaceRuntime,
  fromId: string,
  toId: string,
): boolean {
  if (!fromId || fromId === toId) return false;
  if (!runtime.store.has(fromId) || !runtime.store.has(toId)) return false;
  runtime.sessionModels.set(toId, {
    ...resolveSessionModelSelection(runtime, fromId),
  });
  return true;
}

/**
 * Fleet-wide subagent route from `agent-loop.subagentModel`, spelled
 * `provider/model` (optionally `provider/model (effort)`). Empty / unset →
 * undefined, meaning "inherit the parent's resolved selection".
 */
export function resolveSubagentModelSetting(
  runtime: FaceRuntime,
): FaceModelSelection | undefined {
  const merged = mergedNamespace(runtime, "agent-loop");
  const raw = String(merged.subagentModel ?? "").trim();
  if (!raw) return undefined;
  const route = raw.match(/^([^/\s]+)\/(\S+?)(?:\s*\(([^)]+)\))?$/);
  if (!route) return undefined;
  return {
    provider: route[1]!,
    model: route[2]!,
    ...(route[3]?.trim() ? { reasoningEffort: route[3].trim() } : {}),
  };
}

export async function saveAgentDefaultModel(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): Promise<void> {
  const slot = runtime.settingsNamespaces.ensure("agent-default-model");
  slot.user = {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
  };
  slot.revision += 1;
  await persistSettingsDocument(runtime, runtime.settingsNamespaces);
}
