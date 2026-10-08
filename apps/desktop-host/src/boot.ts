/**
 * Boot XRK Host via createHostManager (compose / Face / serve stack) on
 * **127.0.0.1 loopback** ([ADR-0008](../../../docs/adr/0008-desktop-shell-private-host.md)).
 *
 * Same posture as DSH Desktop: Electron loads `http://127.0.0.1:<port>`;
 * Node IPC is lifecycle-only. No Electron framed Face pipes (ConPTY-safe).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHostManager, type HostInstance } from "@xrkseek/server-host";
import {
  defaultSessionsDir,
  loadHostConfig,
  resolveXrkHome,
} from "@xrkseek/server-config";
import { createServerAgentFactory } from "@xrkseek/preset-server";
import { establishProductHomeSeeds } from "@xrkseek/harness-cli/home-seeds";

export const DESKTOP_HOST_PACKAGE_NAME =
  "@xrkseek/harness-desktop-host" as const;

export interface BootedDesktopHost {
  readonly instance: HostInstance;
  readonly hostVersion: string;
  /** Loopback Face origin, e.g. `http://127.0.0.1:43129`. */
  readonly origin: string;
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
 * Spawn the standard Host composition listening on 127.0.0.1 (ephemeral port).
 * Declares native path capabilities (`XRK_NATIVE_OPEN`) and runtime surface
 * (`XRK_SURFACE=desktop`) so Face / inject match the Electron shell.
 * Establishes `{XRK_HOME}` seeds: awaited on CLI-style boots; on
 * `XRK_SURFACE=desktop` they run in the background so loopback listen is not
 * blocked by hashing the seed tree.
 */
export async function bootXrkDesktopHost(options: {
  readonly projectDir: string;
  readonly webDist?: string;
  readonly workspaceRoot?: string;
}): Promise<BootedDesktopHost> {
  declareDesktopNativeOpenCapabilities();
  declareDesktopRuntimeSurface();

  const home = resolveXrkHome();
  // Do not block loopback listen on hashing/copying skill seeds.
  // CLI `serve` still awaits establish so the first prompt sees a complete home.
  void establishProductHomeSeeds(home, (msg) => {
    process.stderr.write(`${DESKTOP_HOST_PACKAGE_NAME}: ${msg}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${DESKTOP_HOST_PACKAGE_NAME} warn: home seeds: ${message}\n`,
    );
  });

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
      // DSH Desktop posture: loopback only — never 0.0.0.0.
      host: "127.0.0.1",
      port: 0,
      listen: true,
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
        host: "127.0.0.1",
        port: 0,
        listen: true,
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

  const port = instance.health().port;
  if (typeof port !== "number" || port <= 0) {
    await instance.stop();
    throw new Error(
      `${DESKTOP_HOST_PACKAGE_NAME}: Host did not bind a loopback port`,
    );
  }
  const origin = `http://127.0.0.1:${String(port)}`;

  return {
    instance,
    hostVersion: packageVersion(),
    origin,
    fetch: (request) => instance.http.fetch(request),
    dispose: () => instance.stop(),
  };
}
