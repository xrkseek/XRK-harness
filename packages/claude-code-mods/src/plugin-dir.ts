/**
 * Load a Claude Code plugin **directory** — the on-disk shape a published
 * plugin actually ships as:
 *
 * ```
 * my-plugin/
 *   .claude-plugin/plugin.json     { "name": "my-plugin", "version": "0.1.0" }
 *   hooks/hooks.json               { "modules": ["./my-plugin.mjs"] }
 *   hooks/my-plugin.mjs            export function register(on) { … }
 * ```
 *
 * `defineMod` (and the bridge generally) takes a `register` function because a
 * Cordis composition mounts behaviour, not directories. This module is the seam
 * between those two: it reads the manifests, imports each hook module with the
 * native loader, and hands the bridge one `register` that runs them in manifest
 * order. The result is a normal `ModPlugin`, so it composes like any other mod:
 *
 * ```ts
 * await ctx.plugin(await definePluginDir('/path/to/my-plugin'), { history: 12 })
 * ```
 *
 * Ordering matters and is preserved: the first module in `hooks.json` is the
 * outermost layer of the chain, because `on(...)` registrations append and the
 * chain runs registration order outside-in.
 * @module
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { defineMod, type ModPlugin } from "./define-mod.js";
import { nativeImport } from "./native-import.js";
import type { ModOn, PluginOptions } from "./types.js";

/** A plugin directory as its manifests describe it. */
export interface PluginDirInfo {
  /** Absolute plugin root. */
  readonly root: string;
  /** `plugin.json` `name`. */
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  /** Absolute hook-module paths, in `hooks.json` order. */
  readonly modules: readonly string[];
}

export interface LoadPluginDirOptions {
  /** Override for tests or a CSP-locked host; defaults to the native loader. */
  readonly importModule?: (url: string) => Promise<unknown>;
  /** `options` a module's `register(on, options)` receives. */
  readonly options?: PluginOptions;
}

/** Thrown for a directory that is not a well-formed Claude Code plugin. */
export class PluginDirError extends Error {
  constructor(
    readonly dir: string,
    message: string,
  ) {
    super(`${message} (${dir})`);
    this.name = "PluginDirError";
  }
}

/** Plugin names Claude Code accepts: letters, digits, `_` and `-`. */
const PLUGIN_NAME = /^[A-Za-z0-9_-]{1,64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(dir: string, file: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new PluginDirError(dir, `missing ${label}`);
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PluginDirError(dir, `${label} is not valid JSON`);
  }
}

/**
 * Read `.claude-plugin/plugin.json` and, when present, `hooks/hooks.json`.
 *
 * A missing `hooks.json` is legal (an identity-only plugin with no behaviour),
 * but a malformed one is not: silently ignoring it would load a plugin whose
 * author believes it is active. Hook-module paths are relative to
 * `hooks/hooks.json` itself and must stay inside the plugin root — a manifest is
 * third-party data, and `../` traversal would otherwise let it load arbitrary
 * code with the host's privileges.
 */
export async function readPluginDir(dir: string): Promise<PluginDirInfo> {
  const root = path.resolve(dir);
  const raw = await readJson(
    root,
    path.join(root, ".claude-plugin", "plugin.json"),
    ".claude-plugin/plugin.json",
  );
  if (!isRecord(raw)) throw new PluginDirError(root, "plugin.json must be an object");

  const name = raw["name"];
  if (typeof name !== "string" || !PLUGIN_NAME.test(name.trim())) {
    throw new PluginDirError(
      root,
      'plugin.json needs a "name" of letters, digits, _ and - only',
    );
  }
  const version = typeof raw["version"] === "string" ? raw["version"] : undefined;
  const description =
    typeof raw["description"] === "string" ? raw["description"] : undefined;

  const hooksPath = path.join(root, "hooks", "hooks.json");
  const hooksDir = path.dirname(hooksPath);
  let declared: readonly string[] = [];
  try {
    const hooksRaw = await readJson(root, hooksPath, "hooks/hooks.json");
    if (!isRecord(hooksRaw))
      throw new PluginDirError(root, "hooks.json must be an object");
    const modules = hooksRaw["modules"];
    if (modules !== undefined) {
      if (!Array.isArray(modules))
        throw new PluginDirError(
          root,
          'hooks.json "modules" must be an array of paths',
        );
      declared = modules.map((entry) => {
        if (typeof entry !== "string" || entry.trim() === "") {
          throw new PluginDirError(
            root,
            'hooks.json "modules" entries must be non-empty strings',
          );
        }
        return entry.trim();
      });
    }
  } catch (error) {
    // Only "there is no hooks/hooks.json" is tolerable; anything else is the author's bug.
    if (
      !(error instanceof PluginDirError) ||
      !/missing hooks\/hooks\.json/u.test(error.message)
    )
      throw error;
  }

  const modules = declared.map((relative) => {
    const absolute = path.resolve(hooksDir, relative);
    const inside = path.relative(root, absolute);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      throw new PluginDirError(
        root,
        `hook module escapes the plugin root: ${relative}`,
      );
    }
    return absolute;
  });

  return {
    root,
    name: name.trim(),
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    modules,
  };
}

function pickRegister(
  namespace: unknown,
): ((on: ModOn, options?: PluginOptions) => unknown) | undefined {
  if (!isRecord(namespace)) return undefined;
  if (typeof namespace["register"] === "function") {
    return namespace["register"] as (on: ModOn, options?: PluginOptions) => unknown;
  }
  const nested = namespace["default"];
  if (isRecord(nested) && typeof nested["register"] === "function") {
    return nested["register"] as (on: ModOn, options?: PluginOptions) => unknown;
  }
  return undefined;
}

/**
 * Wrap a plugin directory as a mountable mod plugin.
 *
 * Manifest order is chain order: the first module listed is the outermost hook
 * layer. A module that exports no `register` fails the whole load by name rather
 * than mounting a plugin that can never answer an event.
 */
export async function definePluginDir(
  dir: string,
  options: LoadPluginDirOptions = {},
): Promise<ModPlugin> {
  const info = await readPluginDir(dir);
  const importModule = options.importModule ?? nativeImport;
  const registerOptions = options.options;

  return defineMod({
    name: info.name,
    ...(info.version === undefined ? {} : { version: info.version }),
    root: info.root,
    ...(registerOptions === undefined ? {} : { userConfig: registerOptions }),
    register: async (on, modOptions) => {
      for (const modulePath of info.modules) {
        const label = path.relative(info.root, modulePath);
        const namespace = await importModule(pathToFileURL(modulePath).href);
        const register = pickRegister(namespace);
        if (register === undefined) {
          throw new Error(
            `${info.name}: hook module "${label}" exports no register(on)`,
          );
        }
        await register(
          on,
          registerOptions === undefined ? modOptions : registerOptions,
        );
      }
    },
  });
}
