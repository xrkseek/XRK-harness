/**
 * Boot XRK Host via createHostManager (compose / Face / serve stack) with listen disabled.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHostManager, type HostInstance } from "@xrkseek/server-host";
import { loadHostConfig } from "@xrkseek/server-config";
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
 * Spawn the standard Host composition without binding a TCP listen socket.
 * Declares native path capabilities (`XRK_NATIVE_OPEN`) so Face reuses
 * `host.openPath` / `host.pickDirectory` with `canOpenPath: true`.
 */
export async function bootXrkDesktopHost(options: {
  readonly projectDir: string;
  readonly webDist?: string;
  readonly workspaceRoot?: string;
}): Promise<BootedDesktopHost> {
  declareDesktopNativeOpenCapabilities();

  const webDist =
    options.webDist?.trim() ||
    process.env.XRK_DESKTOP_WEB_DIST?.trim() ||
    process.env.XRK_WEB_DIST?.trim() ||
    path.resolve(options.projectDir, "web-dist");

  const config = loadHostConfig({
    patch: {
      workspaceRoot: options.workspaceRoot ?? options.projectDir,
      webDist,
      listen: false,
      preset: "harness",
    },
  });

  const manager = createHostManager();
  const factory = createServerAgentFactory({
    workspaceRoot: config.runtime.workspaceRoot,
  });
  const instance = await manager.spawn(config, factory, {
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
  });

  return {
    instance,
    hostVersion: packageVersion(),
    fetch: (request) => instance.http.fetch(request),
    dispose: () => instance.stop(),
  };
}
