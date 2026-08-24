/**
 * Product shell: CLI-bundled `product-web/`, else monorepo `apps/web/dist`.
 */
import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCT_SHELL_BUILD_HINT =
  "pnpm web:build && pnpm client:bundle && pnpm web:assemble";

export function cliPackageRoot(): string {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}

export function harnessAppsRoot(): string {
  return path.resolve(cliPackageRoot(), "..");
}

export function repoRoot(): string {
  return path.resolve(harnessAppsRoot(), "..");
}

export function isMonorepoCheckout(): boolean {
  return existsSync(path.join(harnessAppsRoot(), "web", "package.json"));
}

/** Assembled shell shipped inside the CLI package (npx / GitHub Release). */
export function bundledProductWebDist(): string {
  return path.join(cliPackageRoot(), "product-web");
}

export function defaultProductWebDist(): string {
  return path.join(harnessAppsRoot(), "web", "dist");
}

export function readCliVersion(): string {
  try {
    const raw = readFileSync(
      path.join(cliPackageRoot(), "package.json"),
      "utf8",
    );
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export { defaultSessionsDir } from "@xrkseek/server-config";

async function distIfReady(dir: string): Promise<string | undefined> {
  try {
    await access(path.join(dir, "index.html"));
    return dir;
  } catch {
    return undefined;
  }
}

/** Resolve an existing product dist. Never `apps/console`. */
export async function resolveProductWebDist(
  configured?: string,
): Promise<string | undefined> {
  if (configured?.trim()) {
    return distIfReady(path.resolve(configured.trim()));
  }
  // Monorepo checkout: prefer freshly assembled `apps/web/dist` over the
  // packaged `product-web/` copy shipped next to the CLI (stale after
  // `client:bundle` + `web:assemble` unless re-staged for release).
  if (isMonorepoCheckout()) {
    const assembled = await distIfReady(defaultProductWebDist());
    if (assembled) return assembled;
  }
  const bundled = await distIfReady(bundledProductWebDist());
  if (bundled) return bundled;
  return distIfReady(defaultProductWebDist());
}

function runPnpmScript(script: string): void {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const r = spawnSync(pnpm, [script], {
    cwd: repoRoot(),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(
      `${script} failed (exit ${r.status ?? 1}). ${PRODUCT_SHELL_BUILD_HINT}`,
    );
  }
}

/**
 * Ensure product UI exists.
 * - configured path missing → error
 * - packaged CLI: `product-web/` next to package.json
 * - monorepo: build `apps/web/dist` if missing
 */
export async function ensureProductWebDist(
  configured?: string,
): Promise<string> {
  const found = await resolveProductWebDist(configured);
  if (found) return found;

  if (configured?.trim()) {
    throw new Error(
      `product UI not found at ${path.resolve(configured.trim())}\nFix XRK_WEB_DIST.`,
    );
  }

  if (!isMonorepoCheckout()) {
    throw new Error(
      `product UI missing (no product-web/). Reinstall @xrkseek/harness-cli or set XRK_WEB_DIST.`,
    );
  }

  process.stderr.write(`apps/web/dist missing — ${PRODUCT_SHELL_BUILD_HINT}\n`);
  for (const script of ["web:build", "client:bundle", "web:assemble"] as const) {
    runPnpmScript(script);
  }
  const after = await resolveProductWebDist();
  if (!after) {
    throw new Error(
      `build finished but ${defaultProductWebDist()}/index.html is still missing`,
    );
  }
  return after;
}
