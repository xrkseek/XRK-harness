/**
 * Resolve packaged / unpackaged Desktop Host runtime (ADR-0008).
 * Packaged layout under `process.resourcesPath`:
 *   runtime/node — bundled upstream Node
 *   host/        — `pnpm deploy` of `@xrkseek/harness-desktop-host`
 *                  (includes `@xrkseek/harness-cli` for Settings plugin mutate)
 *   web/         — assembled product Web (readable by Host Node; not asar)
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { DESKTOP_HOST_NODE_ENV } from "./host-node.js";
import { resolveDesktopAppRoot } from "./build-paths.js";

export interface DesktopHostRuntimePaths {
  readonly nodeExecutable: string;
  readonly projectDir: string;
  readonly entry: string;
  readonly webDist: string;
  /**
   * Absolute path to bundled `harness-cli` `dist/bin.js`.
   * Host always sets `XRK_HARNESS_BIN` — Settings plugin mutate never relies on PATH.
   */
  readonly harnessCliBin: string;
}

function assertFile(filePath: string, label: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`xrk desktop: ${label} missing at ${filePath}`);
  }
  return filePath;
}

function assertDirWithIndex(dir: string, label: string): string {
  const index = path.join(dir, "index.html");
  if (!existsSync(index)) {
    throw new Error(`xrk desktop: ${label} missing index.html at ${dir}`);
  }
  return dir;
}

/** Canonical install: `{host}/node_modules/@xrkseek/harness-cli/dist/bin.js`. */
export function harnessCliBinBesideHost(projectDir: string): string {
  return path.join(
    projectDir,
    "node_modules",
    "@xrkseek",
    "harness-cli",
    "dist",
    "bin.js",
  );
}

function assertHarnessCliBin(
  candidates: readonly string[],
): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "xrk desktop: bundled harness-cli missing " +
      `(expected @xrkseek/harness-cli beside Host; tried ${candidates.join(", ")})`,
  );
}

/**
 * Packaged Host + Web + Node under Electron `resources/`.
 */
export function resolvePackagedDesktopHostRuntime(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): DesktopHostRuntimePaths {
  const root = path.resolve(resourcesPath);
  const nodeExecutable = assertFile(
    path.join(
      root,
      "runtime",
      "node",
      platform === "win32" ? "node.exe" : "node",
    ),
    "bundled Host Node",
  );
  const projectDir = path.join(root, "host");
  const entry = assertFile(
    path.join(projectDir, "dist", "index.js"),
    "deployed Host entry",
  );
  assertFile(
    path.join(
      projectDir,
      "node_modules",
      "@xrkseek",
      "server-host",
      "package.json",
    ),
    "deployed Host server-host (node_modules must ship outside asar)",
  );
  const webDist = assertDirWithIndex(path.join(root, "web"), "product Web");
  const harnessCliBin = assertHarnessCliBin([
    harnessCliBinBesideHost(projectDir),
  ]);
  return {
    nodeExecutable,
    projectDir,
    entry,
    webDist,
    harnessCliBin,
  };
}

/**
 * Unpackaged development: monorepo `apps/desktop-host` + `apps/web/dist`.
 * Requires {@link DESKTOP_HOST_NODE_ENV} (set by `dev:desktop`).
 */
export function resolveUnpackagedDesktopHostRuntime(
  options: {
    readonly desktopAppRoot?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly webDist?: string;
  } = {},
): DesktopHostRuntimePaths {
  const env = options.env ?? process.env;
  const fromEnv = env[DESKTOP_HOST_NODE_ENV]?.trim();
  if (!fromEnv) {
    throw new Error(
      `xrk desktop: set ${DESKTOP_HOST_NODE_ENV} for unpackaged Host ` +
        "(pnpm dev:desktop sets this)",
    );
  }
  const nodeExecutable = assertFile(
    path.resolve(fromEnv),
    DESKTOP_HOST_NODE_ENV,
  );
  const appRoot = path.resolve(
    options.desktopAppRoot ?? resolveDesktopAppRoot(),
  );
  const projectDir = path.resolve(appRoot, "..", "desktop-host");
  const entry = assertFile(
    path.join(projectDir, "dist", "index.js"),
    "desktop-host dist",
  );
  const webDist =
    options.webDist?.trim() ||
    assertDirWithIndex(
      path.resolve(appRoot, "..", "web", "dist"),
      "apps/web/dist",
    );
  const harnessCliBin = assertHarnessCliBin([
    harnessCliBinBesideHost(projectDir),
    path.resolve(appRoot, "..", "cli", "dist", "bin.js"),
  ]);
  return {
    nodeExecutable,
    projectDir,
    entry,
    webDist,
    harnessCliBin,
  };
}
