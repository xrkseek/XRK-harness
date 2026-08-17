import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "@xrkseek/core-tools";
import type { RegisteredPlugin, PluginPromptSection } from "./types.js";
import type { DiscoveryHit } from "./manifest.js";

function asToolDefinition(value: unknown, label: string): ToolDefinition {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: tool must be an object`);
  }
  const o = value as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name) {
    throw new Error(`${label}: tool.name must be a non-empty string`);
  }
  if (typeof o.description !== "string") {
    throw new Error(`${label}: tool.description must be a string`);
  }
  if (
    !o.parameters ||
    typeof o.parameters !== "object" ||
    Array.isArray(o.parameters)
  ) {
    throw new Error(`${label}: tool.parameters must be an object`);
  }
  if (typeof o.execute !== "function") {
    throw new Error(`${label}: tool.execute must be a function`);
  }
  return {
    name: o.name,
    description: o.description,
    parameters: o.parameters as Record<string, unknown>,
    execute: o.execute as ToolDefinition["execute"],
  };
}

function asPromptSection(value: unknown, label: string): PluginPromptSection {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: prompt section must be an object`);
  }
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) {
    throw new Error(`${label}: prompt section id must be a non-empty string`);
  }
  if (o.order !== undefined && typeof o.order !== "number") {
    throw new Error(`${label}: prompt section order must be a number`);
  }
  if (typeof o.content !== "string" && typeof o.content !== "function") {
    throw new Error(
      `${label}: prompt section content must be a string or function`,
    );
  }
  return {
    id: o.id,
    ...(typeof o.order === "number" ? { order: o.order } : {}),
    content: o.content as string | (() => string | Promise<string>),
  };
}

function asPlugin(value: unknown, label: string): RegisteredPlugin {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: expected plugin object`);
  }
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.kind !== "string") {
    throw new Error(`${label}: plugin must have string id and kind`);
  }
  const dispose = o.dispose;
  if (dispose !== undefined && typeof dispose !== "function") {
    throw new Error(`${label}: dispose must be a function`);
  }

  let tools: ToolDefinition[] | undefined;
  if (o.tools !== undefined) {
    if (!Array.isArray(o.tools)) {
      throw new Error(`${label}: tools must be an array`);
    }
    tools = o.tools.map((t, i) =>
      asToolDefinition(t, `${label}: tools[${i}]`),
    );
  }

  let promptSections: PluginPromptSection[] | undefined;
  if (o.promptSections !== undefined) {
    if (!Array.isArray(o.promptSections)) {
      throw new Error(`${label}: promptSections must be an array`);
    }
    promptSections = o.promptSections.map((s, i) =>
      asPromptSection(s, `${label}: promptSections[${i}]`),
    );
  }

  const base: RegisteredPlugin = {
    id: o.id,
    kind: o.kind,
    ...(tools ? { tools } : {}),
    ...(promptSections ? { promptSections } : {}),
  };
  if (typeof dispose === "function") {
    return {
      ...base,
      dispose: dispose as () => void | Promise<void>,
    };
  }
  return base;
}

/**
 * Dynamic-import a plugin entry module.
 * Accepts: `createPlugin()`, default export factory, or `export const plugin`.
 */
export async function loadPluginModule(
  entryPath: string,
): Promise<RegisteredPlugin> {
  // realpath avoids Windows 8.3 short paths that break Vite/Vitest dynamic import
  const resolved = await realpath(entryPath);
  const href = pathToFileURL(resolved).href;
  const mod = (await import(/* @vite-ignore */ href)) as Record<
    string,
    unknown
  >;

  if (typeof mod.createPlugin === "function") {
    return asPlugin(
      await (
        mod.createPlugin as () => RegisteredPlugin | Promise<RegisteredPlugin>
      )(),
      entryPath,
    );
  }
  if (typeof mod.default === "function") {
    return asPlugin(
      await (
        mod.default as () => RegisteredPlugin | Promise<RegisteredPlugin>
      )(),
      entryPath,
    );
  }
  if (mod.plugin !== undefined) {
    return asPlugin(mod.plugin, entryPath);
  }
  throw new Error(
    `${entryPath}: expected createPlugin(), default export factory, or export const plugin`,
  );
}

export async function loadDiscoveryHit(
  hit: DiscoveryHit,
): Promise<RegisteredPlugin> {
  const plugin = await loadPluginModule(hit.entry);
  if (plugin.id !== hit.manifest.id) {
    throw new Error(
      `plugin id mismatch: manifest=${hit.manifest.id} module=${plugin.id}`,
    );
  }
  if (plugin.kind !== hit.manifest.kind) {
    throw new Error(
      `plugin kind mismatch: manifest=${hit.manifest.kind} module=${plugin.kind}`,
    );
  }
  return plugin;
}
