import type { PostHandler, PreHandler, ToolPipeline } from "@xrkseek/core-tools";
import type { RegisteredPlugin } from "./types.js";

/** In-process tool hook contribution (`kind: "hooks"`). */
export type PluginToolHooks = NonNullable<RegisteredPlugin["hooks"]>;

export interface AppliedPluginHook {
  readonly pluginId: string;
  readonly stage: "pre" | "post";
}

/**
 * `kind: "hooks"` plugins contribute in-process pre/post tool interceptors.
 * Presets call {@link wireCompositionHooks} on the existing ToolPipeline
 * (same waterfall as policy `onPre` — no pipeline fork).
 */
export function isHooksPlugin(
  plugin: RegisteredPlugin,
): plugin is RegisteredPlugin & { readonly kind: "hooks" } {
  return plugin.kind === "hooks";
}

/** Inventory helper: which hook stages each plugin registered. */
export function applyHooksPlugins(
  plugins: readonly RegisteredPlugin[],
): { readonly applied: readonly AppliedPluginHook[] } {
  const applied: AppliedPluginHook[] = [];
  for (const plugin of plugins) {
    if (!isHooksPlugin(plugin)) continue;
    for (const _ of plugin.hooks?.onPre ?? []) {
      applied.push({ pluginId: plugin.id, stage: "pre" });
    }
    for (const _ of plugin.hooks?.onPost ?? []) {
      applied.push({ pluginId: plugin.id, stage: "post" });
    }
  }
  return { applied };
}

/**
 * Fail-open: a throwing hook must not abort the tool waterfall.
 * Explicit deny / ask / block / replace still win.
 */
function safePre(handler: PreHandler): PreHandler {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch {
      return { action: "continue", args: ctx.args };
    }
  };
}

function safePost(handler: PostHandler): PostHandler {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch {
      return { action: "accept" };
    }
  };
}

/**
 * Register `kind: "hooks"` handlers onto an existing pipeline.
 * Call after policy `onPre` (and other host gates) so declarative policy
 * stays ahead of imperative hooks; call before builtin post trackers so
 * replace/block see the raw tool result first.
 */
export function wireCompositionHooks(
  pipeline: ToolPipeline,
  options: { readonly plugins?: readonly RegisteredPlugin[] } = {},
): { readonly applied: readonly AppliedPluginHook[] } {
  const applied: AppliedPluginHook[] = [];
  for (const plugin of options.plugins ?? []) {
    if (!isHooksPlugin(plugin)) continue;
    for (const handler of plugin.hooks?.onPre ?? []) {
      pipeline.onPre(safePre(handler));
      applied.push({ pluginId: plugin.id, stage: "pre" });
    }
    for (const handler of plugin.hooks?.onPost ?? []) {
      pipeline.onPost(safePost(handler));
      applied.push({ pluginId: plugin.id, stage: "post" });
    }
  }
  return { applied };
}
