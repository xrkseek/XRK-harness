/**
 * Compile-time boundary test: the compatibility layer must stay optional and
 * encapsulated.
 *
 * Two directions are pinned:
 *
 * 1. Main project (apps/*, packages/client/*, packages/server/face,
 *    packages/server/host) never imports the dsh-compat sub-path directly —
 *    the only legal consumer entry is the `@xrkseek/server-http` root export
 *    (host/src/index.ts imports `prewarmDshCompatAdapters` from there).
 * 2. dsh-compat internals never reverse-depend on main-project business
 *    packages (server-face / server-host / client-* / apps/*). Its external
 *    package surface is a small infrastructure whitelist (core-session,
 *    im-gateway-contract, policy, server-loader, xrk-home-paths) — exactly the
 *    peer/inject surface PACKAGE.md names for extracting `@xrkseek/dsh-compat`.
 *
 * The scan is static (source text), so it runs without a build and fails on
 * the first occurrence of a crossing import.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DSH_COMPAT_DIR = join(REPO_ROOT, "packages/server/http/src/dsh-compat");
const HTTP_ROOT = join(REPO_ROOT, "packages/server/http/src/index.ts");

/** Packages that belong to the main product and must not import dsh-compat internals. */
const MAIN_PROJECT_DIRS = [
  join(REPO_ROOT, "packages/client"),
  join(REPO_ROOT, "packages/server/face"),
  join(REPO_ROOT, "packages/server/host"),
  join(REPO_ROOT, "apps"),
];

/** Main-project business packages dsh-compat internals must never import. */
const FORBIDDEN_MAIN_PACKAGES = [
  "@xrkseek/server-face",
  "@xrkseek/server-host",
  "@xrkseek/client-",
  "@xrkseek/xrk-client-",
];

/** Infrastructure whitelist dsh-compat may import externally (extraction peers). */
const DSH_COMPAT_ALLOWED_EXTERNAL = [
  "@xrkseek/core-session",
  "@xrkseek/im-gateway-contract",
  "@xrkseek/policy",
  "@xrkseek/server-loader",
  "@xrkseek/xrk-home-paths",
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".xrk",
  "out",
  "target",
]);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let dirent;
    try {
      dirent = statSync(p);
    } catch {
      continue;
    }
    if (dirent.isDirectory()) {
      walkTs(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const importSpecifiers = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

describe("dsh-compat compile-time boundary", () => {
  it("main project never imports the dsh-compat sub-path or internals", () => {
    const crossings: string[] = [];
    for (const root of MAIN_PROJECT_DIRS) {
      if (!statSync(root, { throwIfNoEntry: false })) continue;
      for (const file of walkTs(root)) {
        for (const spec of importSpecifiers(file)) {
          if (
            spec.includes("/dsh-compat") ||
            spec.includes("src/dsh-compat")
          ) {
            crossings.push(`${relative(REPO_ROOT, file)} -> ${spec}`);
          }
        }
      }
    }
    expect(crossings, "main project must not import dsh-compat internals").toEqual([]);
  });

  it("dsh-compat internals never reverse-depend on main-project business packages", () => {
    const crossings: string[] = [];
    for (const file of walkTs(DSH_COMPAT_DIR)) {
      for (const spec of importSpecifiers(file)) {
        if (FORBIDDEN_MAIN_PACKAGES.some((p) => spec.startsWith(p))) {
          crossings.push(`${relative(REPO_ROOT, file)} -> ${spec}`);
        }
      }
    }
    expect(crossings, "dsh-compat must not import main-project packages").toEqual([]);
  });

  it("dsh-compat external package surface stays inside the infrastructure whitelist", () => {
    const offenders: string[] = [];
    for (const file of walkTs(DSH_COMPAT_DIR)) {
      for (const spec of importSpecifiers(file)) {
        if (spec.startsWith("@xrkseek/")) {
          if (!DSH_COMPAT_ALLOWED_EXTERNAL.includes(spec)) {
            offenders.push(`${relative(REPO_ROOT, file)} -> ${spec}`);
          }
        }
      }
    }
    expect(
      offenders,
      "every @xrkseek external of dsh-compat must be on the extraction whitelist",
    ).toEqual([]);
  });

  it("server-http root index re-exports the dsh-compat surface (the legal consumer entry)", () => {
    const rootText = readFileSync(HTTP_ROOT, "utf8");
    expect(rootText).toMatch(/from "\.\/dsh-compat\/index\.js"/);
  });
});
