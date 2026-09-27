/**
 * Client-half browser lane. The unit lane (`vitest.config.ts`) collects only
 * `*.test.ts`, and the ui-conversation lane covers two packages; this lane
 * sweeps every `packages/client/**\/*.client.spec.ts(x)`, which is where the
 * browser half of the product is actually specified.
 *
 * Three things make it runnable:
 *
 * 1. Aliases point each `@xrkseek/client-*` subpath at its TypeScript source.
 *    The published `lib/` halves are CJS bundles (and gitignored), so a spec
 *    that resolved through them would both fail to load and exercise a
 *    different module instance than its siblings.
 * 2. Bare stub packages (`xrk-invariants`, `xrk-settings`, …) resolve to their
 *    `src/`, for the same reason the unit lane keeps them off `lib/`.
 * 3. `@xrkseek/client-test-runtime` is the workspace placeholder stub; it ships
 *    the shared doubles (`stubSettingsScope`, `TestRemote`,
 *    `usePinnedBrowserLanguages`, …) so specs need no per-file scaffolding.
 *
 * `pnpm test:client` runs it. Not part of `pnpm check` yet: the lane is being
 * brought green package by package. Use `pnpm test:ui-conversation` for the
 * smaller conversation / attachment / deliverables whitelist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import unit from "./vitest.config.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Read a workspace package's manifest name, or `undefined` when there is none. */
function packageName(manifestPath: string): string | undefined {
  if (!fs.existsSync(manifestPath)) return undefined;
  // A stray UTF-8 BOM survives on some checkouts and `JSON.parse` rejects it.
  const source = fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "");
  return (JSON.parse(source) as { name?: string }).name;
}

/**
 * Map every client package subpath that has a TypeScript entry to that entry,
 * including the package-scoped `…/src/*` prefix that specs import siblings
 * through (a package cannot resolve its own name without a self-link).
 * @returns the alias entries, unsorted.
 */
function clientSourceAliases(): [string, string][] {
  const dir = path.join(root, "packages", "client");
  const entries: [string, string][] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const pkgName = packageName(path.join(dir, name, "package.json"));
    if (!pkgName) continue;
    const src = path.join(dir, name, "src");
    const subpaths: [string, string][] = [
      [`${pkgName}/client`, path.join(src, "client", "index.ts")],
      [`${pkgName}/invariant`, path.join(src, "invariant.ts")],
      [`${pkgName}/src`, src],
      [pkgName, path.join(src, "index.ts")],
    ];
    for (const [specifier, entry] of subpaths) {
      // The `…/src` entry is a directory prefix; the rest must be real files.
      if (entry !== src && !fs.existsSync(entry)) continue;
      if (entry === src && !fs.existsSync(src)) continue;
      entries.push([specifier, entry]);
    }
  }
  return entries;
}

/**
 * Map every stub package's `src/` entry points: its root, plus each top-level
 * module (the stub subpaths the client half imports, e.g. `xrk-llm/message`).
 * @returns the alias entries, unsorted.
 */
function stubSourceAliases(): [string, string][] {
  const dir = path.join(root, "packages", "stubs");
  const entries: [string, string][] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const pkgName = packageName(path.join(dir, name, "package.json"));
    if (!pkgName) continue;
    const src = path.join(dir, name, "src");
    if (!fs.existsSync(path.join(src, "index.ts"))) continue;
    entries.push([pkgName, path.join(src, "index.ts")]);
    for (const file of fs.readdirSync(src)) {
      if (!file.endsWith(".ts") || file === "index.ts") continue;
      entries.push([`${pkgName}/${file.slice(0, -".ts".length)}`, path.join(src, file)]);
    }
  }
  return entries;
}

/**
 * Node >= 22 ships an experimental `localStorage` global that stays `undefined`
 * unless the process runs with `--localstorage-file`. Vitest's jsdom
 * environment only fills globals that are absent, so that dead global shadows
 * jsdom's working storage and every spec's `localStorage.clear()` throws.
 * Turning the Node global off lets jsdom's own storage land intact; older Node
 * builds do not know the flag, so it is gated on support.
 */
const webStorageFlag = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
  ? ["--no-experimental-webstorage"]
  : [];

const config = mergeConfig(
  unit,
  defineConfig({
    test: {
      include: [
        "packages/client/**/tests/**/*.client.spec.ts",
        "packages/client/**/tests/**/*.client.spec.tsx",
      ],
      environment: "jsdom",
      setupFiles: ["./vitest.client.setup.ts"],
      poolOptions: { forks: { execArgv: webStorageFlag } },
    },
    resolve: {
      alias: Object.fromEntries([
        ...clientSourceAliases(),
        ...stubSourceAliases(),
        // Not a stub, but its `lib/` is equally unbuilt for tests.
        ["@xrkseek/schemastery", path.join(root, "packages/schemastery/src/index.ts")],
      ]),
    },
  }),
);

/**
 * Re-sort the merged alias map longest-specifier-first: `mergeConfig` appends
 * this lane's keys after the unit map's, and Vite's object aliases are
 * prefix-matched in insertion order — so a package-root entry would otherwise
 * swallow its own subpaths.
 * @param map - the merged alias map.
 * @returns the same entries, longest specifier first.
 */
function longestFirst(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => b.length - a.length));
}

export default defineConfig({
  ...config,
  resolve: {
    ...config.resolve,
    alias: longestFirst((config.resolve?.alias as Record<string, string>) ?? {}),
  },
});
