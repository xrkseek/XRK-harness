/**
 * Model catalog + shared default selection (DSH `agent-default-model` parity).
 */
import type { BrandEntry } from "@xrkseek/llm-registry";
import type { FaceRuntime } from "./context.js";
import { DEFAULT_DEEPSEEK_MODELS } from "./settings-schemas.js";
import { mergeLayers, persistSettingsDocument } from "./settings-document.js";
import { providerHasUsableCredential } from "./llm-provider-context.js";

export interface FaceModelEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

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
    slot.base as Record<string, unknown>,
    slot.user as Record<string, unknown>,
  );
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
    out.push({
      id,
      name,
      ...(typeof descRaw === "string" && descRaw.trim()
        ? { description: descRaw.trim() }
        : {}),
    });
  }
  return out;
}

function deepseekModels(runtime: FaceRuntime): FaceModelEntry[] {
  const merged = mergedNamespace(runtime, "llm-deepseek");
  const fromSettings = asModelRows(merged.models);
  if (fromSettings.length > 0) return fromSettings;
  return DEFAULT_DEEPSEEK_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    ...(m.description ? { description: m.description } : {}),
  }));
}

function piAiProviderModels(
  runtime: FaceRuntime,
  brandId: string,
): FaceModelEntry[] {
  const merged = mergedNamespace(runtime, "llm-pi-ai");
  const providers = merged.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return [];
  }
  const profile = (providers as Record<string, unknown>)[brandId];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return [];
  }
  return asModelRows((profile as { models?: unknown }).models);
}

function modelsForBrand(
  runtime: FaceRuntime,
  brand: BrandEntry,
): FaceModelEntry[] {
  if (brand.id === "deepseek") return deepseekModels(runtime);
  const configured = piAiProviderModels(runtime, brand.id);
  if (configured.length > 0) return configured;
  if (brand.defaultModel) {
    return [{ id: brand.defaultModel, name: brand.defaultModel }];
  }
  return [];
}

/** DSH `routeServed`: whether this deployment exposes a route for the provider (not API-key gating). */
export function routeServed(runtime: FaceRuntime, provider: string): boolean {
  const id = provider.trim();
  if (!id) return false;
  try {
    runtime.registry.resolve({ provider: id });
    return true;
  } catch {
    return false;
  }
}

function providerHasCredentials(
  runtime: FaceRuntime,
  brandId: string,
): boolean {
  return providerHasUsableCredential(runtime, brandId);
}

/** Provider-grouped catalog for composer + `llm.models` (no `"default"` placeholders). */
export function buildFaceModelCatalog(
  runtime: FaceRuntime,
): { groups: FaceModelProviderGroup[]; failures: [] } {
  const groups: FaceModelProviderGroup[] = [];
  for (const brand of runtime.registry.listBrands()) {
    if (!brand.baseUrl && brand.id !== "ollama") continue;
    const models = modelsForBrand(runtime, brand);
    if (models.length === 0) continue;
    groups.push({
      id: brand.id,
      name: brand.displayName,
      models,
    });
  }
  return { groups, failures: [] };
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

/** Resolve current selection: session override → saved default → first routable catalog row. */
export function resolveSessionModelSelection(
  runtime: FaceRuntime,
  sessionId: string,
): FaceModelSelection {
  const override = runtime.sessionModels.get(sessionId);
  if (override) return override;

  const saved = resolveAgentDefaultModel(runtime);
  if (saved) {
    try {
      runtime.registry.resolve(saved);
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
        providerHasCredentials(runtime, b.id) &&
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
  return { provider: "deepseek", model: "deepseek-v4-flash" };
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
