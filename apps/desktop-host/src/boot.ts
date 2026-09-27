/**
 * Boot XRK Host via createHostManager (compose / Face / serve stack) with listen disabled.
 * Renderer reaches Face through `xrk-app://` + framed pipes (ADR-0008 / DSH posture):
 * no product or loopback Web listen.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHostManager, type HostInstance } from "@xrkseek/server-host";
import {
  defaultSessionsDir,
  loadHostConfig,
} from "@xrkseek/server-config";
import { createServerAgentFactory } from "@xrkseek/preset-server";

export const DESKTOP_HOST_PACKAGE_NAME =
  "@xrkseek/harness-desktop-host" as const;

export interface BootedDesktopHost {
  readonly instance: HostInstance;
  readonly hostVersion: string;
  fetch(request: Request): Promise<Response>;
  dispose(): Promise<void>;
}

function packageVersion(): string {
  try {
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return typeof raw.version === "string" ? raw.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Advertise Face `canOpenPath` / pickDirectory for this Desktop Host process.
 * Reuses existing `host.openPath` · `host.pickDirectory` — no second opener.
 */
export function declareDesktopNativeOpenCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.XRK_NATIVE_OPEN = "1";
}

/**
 * Declare `XRK_SURFACE=desktop` so Workspace inject emits `## Runtime surface`
 * and the model can tell the Electron shell from `xrkh web` / browser.
 * Does not overwrite an explicit env value (CI / nested Host).
 */
export function declareDesktopRuntimeSurface(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.XRK_SURFACE === undefined) env.XRK_SURFACE = "desktop";
}

/**
 * Spawn the standard Host composition without binding a TCP listen socket.
 * Declares native path capabilities (`XRK_NATIVE_OPEN`) and runtime surface
 * (`XRK_SURFACE=desktop`) so Face / inject match the Electron shell.
 */
export async function bootXrkDesktopHost(options: {
  readonly projectDir: string;
  readonly webDist?: string;
  readonly workspaceRoot?: string;
}): Promise<BootedDesktopHost> {
  declareDesktopNativeOpenCapabilities();
  declareDesktopRuntimeSurface();

  const webDist =
    options.webDist?.trim() ||
    process.env.XRK_DESKTOP_WEB_DIST?.trim() ||
    process.env.XRK_WEB_DIST?.trim() ||
    path.resolve(options.projectDir, "web-dist");

  const workspaceRoot =
    options.workspaceRoot?.trim() ||
    process.env.XRK_WORKSPACE_ROOT?.trim() ||
    undefined;

  const config = loadHostConfig({
    patch: {
      ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      webDist,
      listen: false,
      preset: "harness",
    },
  });

  // Same as `xrkh serve --persist`: share ~/.xrk/sessions with CLI/web.
  const sessionsDir =
    config.runtime.sessionsDir?.trim() || defaultSessionsDir();

  const manager = createHostManager();
  const factory = createServerAgentFactory({
    workspaceRoot: config.runtime.workspaceRoot,
  });
  const instance = await manager.spawn(
    {
      ...config,
      runtime: {
        ...config.runtime,
        sessionsDir,
      },
    },
    factory,
    {
      logger: {
        info: (msg) => {
          process.stderr.write(`${DESKTOP_HOST_PACKAGE_NAME}: ${msg}\n`);
        },
        debug: () => undefined,
        warn: (msg) => {
          process.stderr.write(`${DESKTOP_HOST_PACKAGE_NAME} warn: ${msg}\n`);
        },
        error: (msg) => {
          process.stderr.write(`${DESKTOP_HOST_PACKAGE_NAME} error: ${msg}\n`);
        },
      },
    },
  );

  return {
    instance,
    hostVersion: packageVersion(),
    fetch: (request) => instance.http.fetch(request),
    dispose: () => instance.stop(),
  };
}
