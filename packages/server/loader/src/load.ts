import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "@xrkseek/core-tools";
import type {
  RegisteredPlugin,
  PluginPromptSection,
  PluginCommand,
  HostPublicHandlerFn,
  HostWireContext,
} from "./types.js";
import type { DiscoveryHit, PluginManifest } from "./manifest.js";

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

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u;

function asCommand(value: unknown, label: string): PluginCommand {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: command must be an object`);
  }
  const o = value as Record<string, unknown>;
  if (typeof o.name !== "string" || !COMMAND_NAME.test(o.name)) {
    throw new Error(`${label}: command.name must match ${COMMAND_NAME}`);
  }
  if (typeof o.description !== "string") {
    throw new Error(`${label}: command.description must be a string`);
  }
  if (typeof o.handler !== "function") {
    throw new Error(`${label}: command.handler must be a function`);
  }
  let input: { hint: string } | undefined;
  if (o.input !== undefined) {
    if (!o.input || typeof o.input !== "object" || Array.isArray(o.input)) {
      throw new Error(`${label}: command.input must be an object`);
    }
    const hint = (o.input as Record<string, unknown>).hint;
    if (typeof hint !== "string") {
      throw new Error(`${label}: command.input.hint must be a string`);
    }
    input = { hint };
  }
  return {
    name: o.name,
    description: o.description,
    ...(input ? { input } : {}),
    handler: o.handler as PluginCommand["handler"],
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

  let commands: PluginCommand[] | undefined;
  if (o.commands !== undefined) {
    if (!Array.isArray(o.commands)) {
      throw new Error(`${label}: commands must be an array`);
    }
    commands = o.commands.map((c, i) => asCommand(c, `${label}: commands[${i}]`));
  }

  let createPublicHandler:
    | ((ctx: HostWireContext) => HostPublicHandlerFn)
    | undefined;
  if (typeof o.createPublicHandler === "function") {
    createPublicHandler = o.createPublicHandler as (
      ctx: HostWireContext,
    ) => HostPublicHandlerFn;
  }

  const base: RegisteredPlugin = {
    id: o.id,
    kind: o.kind,
    ...(tools ? { tools } : {}),
    ...(promptSections ? { promptSections } : {}),
    ...(commands ? { commands } : {}),
    ...(createPublicHandler ? { createPublicHandler } : {}),
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
 * Native dynamic import that Vitest/Vite cannot rewrite.
 * Needed for percent-encoded non-ASCII file URLs (e.g. Chinese path segments).
 */
function importHref(href: string): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Vitest rewrites import(); Function keeps Node native loader
  const run = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<Record<string, unknown>>;
  return run(href);
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
  const mod = await importHref(href);

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

export function stubFromManifest(
  manifest: Pick<PluginManifest, "id" | "kind">,
): RegisteredPlugin {
  return { id: manifest.id, kind: manifest.kind };
}

export async function loadDiscoveryHit(
  hit: DiscoveryHit,
): Promise<RegisteredPlugin> {
  if (hit.manifest.skipLoad) {
    return stubFromManifest(hit.manifest);
  }
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
