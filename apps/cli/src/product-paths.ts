/**
 * Product shell: packaged `@xrkseek/web-frontend/dist`, else monorepo `apps/web/dist`.
 */
import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCT_SHELL_BUILD_HINT =
  "pnpm web:build && pnpm client:bundle && pnpm web:assemble";

const requireFromHere = createRequire(import.meta.url);

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

export function defaultSessionsDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".xrk", "sessions");
}

async function distIfReady(dir: string): Promise<string | undefined> {
  try {
    await access(path.join(dir, "index.html"));
    return dir;
  } catch {
    return undefined;
  }
}

function packagedWebFrontendDist(): string | undefined {
  try {
    const pkg = requireFromHere.resolve("@xrkseek/web-frontend/package.json");
    return path.join(path.dirname(pkg), "dist");
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
  const packaged = packagedWebFrontendDist();
  if (packaged) {
    const ready = await distIfReady(packaged);
    if (ready) return ready;
  }
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
 * - `configured` missing → error (no auto-build)
 * - npm install: use `@xrkseek/web-frontend/dist`
 * - git checkout: build `apps/web/dist` if missing
 */
export async function ensureProductWebDist(
  configured?: string,
): Promise<string> {
  const found = await resolveProductWebDist(configured);
  if (found) return found;

  if (configured?.trim()) {
    throw new Error(
      `product UI not found at ${path.resolve(configured.trim())}\nFix XRK_WEB_DIST or install @xrkseek/web-frontend.`,
    );
  }

  if (!isMonorepoCheckout()) {
    throw new Error(
      `product UI missing. Install @xrkseek/web-frontend (npx @xrkseek/harness-cli web) or set XRK_WEB_DIST.`,
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
