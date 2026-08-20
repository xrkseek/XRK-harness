/**
 * Model catalog + shared default selection (DSH `agent-default-model` parity).
 */
import type { BrandEntry } from "@xrkseek/llm-registry";
import type { FaceRuntime } from "./context.js";
import { DEFAULT_DEEPSEEK_MODELS } from "./settings-schemas.js";
import { mergeLayers, persistSettingsDocument } from "./settings-document.js";
import {
  listDeclaredPiAiProviders,
  piAiProviderProfile,
  providerHasUsableCredential,
  providerRouteServed,
  resolveProviderBinding,
} from "./llm-provider-context.js";

export interface FaceModelEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindow?: number;
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
    slot.base,
    slot.user,
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
    const cwRaw = (row as { contextWindow?: unknown }).contextWindow;
    out.push({
      id,
      name,
      ...(typeof descRaw === "string" && descRaw.trim()
        ? { description: descRaw.trim() }
        : {}),
      ...(typeof cwRaw === "number" &&
      Number.isInteger(cwRaw) &&
      cwRaw > 0
        ? { contextWindow: cwRaw }
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
    ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
  }));
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
  if (brand.defaultModel) {
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
    if (!brand.baseUrl && brand.id !== "ollama") continue;
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
    groups.push({
      id: declared.id,
      name: declared.displayName,
      models: declared.models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
      })),
    });
  }
  return { groups, failures: [] };
}

/** Look up catalog contextWindow for a selection (Face contextPressure denominator). */
export function lookupModelContextWindow(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): number | undefined {
  const brand = runtime.registry
    .listBrands()
    .find((b) => b.id === selection.provider);
  if (!brand) {
    if (selection.provider === "deepseek") {
      return deepseekModels(runtime).find((m) => m.id === selection.model)
        ?.contextWindow;
    }
    return piAiProviderModels(runtime, selection.provider).find(
      (m) => m.id === selection.model,
    )?.contextWindow;
  }
  return modelsForBrand(runtime, brand).find((m) => m.id === selection.model)
    ?.contextWindow;
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
