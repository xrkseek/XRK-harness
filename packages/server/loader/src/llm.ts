import {
  createProviderRegistry,
  type BrandEntry,
  type ProviderRegistry,
} from "@xrkseek/llm-registry";
import type { RegisteredPlugin } from "./types.js";

export interface AppliedPluginLlmBrand {
  readonly pluginId: string;
  readonly brandId: string;
}

export interface SkippedPluginLlmBrand extends AppliedPluginLlmBrand {
  readonly reason: "explicit_wins";
}

export interface ApplyLlmPluginsResult {
  readonly applied: readonly AppliedPluginLlmBrand[];
  readonly skipped: readonly SkippedPluginLlmBrand[];
}

export function isLlmPlugin(
  plugin: RegisteredPlugin,
): plugin is RegisteredPlugin & { readonly kind: "llm" } {
  return plugin.kind === "llm";
}

/** Collect LLM registry brand rows from `kind: "llm"` plugins. */
export function collectLlmBrands(
  plugins: readonly RegisteredPlugin[],
): readonly BrandEntry[] {
  const brands: BrandEntry[] = [];
  for (const plugin of plugins) {
    if (!isLlmPlugin(plugin)) continue;
    brands.push(...(plugin.llmBrands ?? []));
  }
  return brands;
}

/**
 * Register plugin LLM brands on the Host registry.
 * **Explicit wins:** skip when `listBrands()` already contains the brand id.
 */
export function wireCompositionLlm(
  registry: ProviderRegistry,
  options: {
    readonly plugins?: readonly RegisteredPlugin[];
  } = {},
): ApplyLlmPluginsResult {
  const applied: AppliedPluginLlmBrand[] = [];
  const skipped: SkippedPluginLlmBrand[] = [];
  const known = new Set(registry.listBrands().map((b) => b.id));

  for (const plugin of options.plugins ?? []) {
    if (!isLlmPlugin(plugin)) continue;
    for (const entry of plugin.llmBrands ?? []) {
      if (known.has(entry.id)) {
        skipped.push({
          pluginId: plugin.id,
          brandId: entry.id,
          reason: "explicit_wins",
        });
        continue;
      }
      registry.registerBrand(entry);
      known.add(entry.id);
      applied.push({ pluginId: plugin.id, brandId: entry.id });
    }
  }

  return { applied, skipped };
}

/**
 * Host / preset helper: create (or reuse) a registry and register `kind: llm`
 * plugin brands. Explicit registry ids win — safe to call after MCP reconcile.
 */
export function createProviderRegistryFromPlugins(
  options: {
    readonly registry?: ProviderRegistry;
    readonly brands?: readonly BrandEntry[];
    readonly plugins?: readonly RegisteredPlugin[];
  } = {},
): ProviderRegistry {
  const registry =
    options.registry ??
    createProviderRegistry(
      options.brands !== undefined ? { brands: options.brands } : {},
    );
  wireCompositionLlm(registry, {
    ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
  });
  return registry;
}

/** Inventory helper: which LLM brands each plugin registered. */
export function applyLlmPlugins(
  plugins: readonly RegisteredPlugin[],
): { readonly applied: readonly AppliedPluginLlmBrand[] } {
  const applied: AppliedPluginLlmBrand[] = [];
  for (const plugin of plugins) {
    if (!isLlmPlugin(plugin)) continue;
    for (const entry of plugin.llmBrands ?? []) {
      applied.push({ pluginId: plugin.id, brandId: entry.id });
    }
  }
  return { applied };
}
