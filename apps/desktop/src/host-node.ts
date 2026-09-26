/**
 * Resolve the upstream Node binary that runs Desktop Host (ADR-0008).
 * Must not be Electron's GUI `process.execPath` without a real Node — Host
 * runs outside the Electron process (packaged: bundled runtime; unpackaged:
 * system Node via `XRK_DESKTOP_HOST_NODE` from `dev:desktop`).
 */

import { existsSync } from "node:fs";
import path from "node:path";

/** Env override for the Host Node executable (set by `dev:desktop`). */
export const DESKTOP_HOST_NODE_ENV = "XRK_DESKTOP_HOST_NODE" as const;

/**
 * Absolute path to the Node binary used to spawn {@link DesktopHostProcess}.
 */
export function resolveDesktopHostNodeExecutable(options: {
  readonly isPackaged: boolean;
  /** `process.resourcesPath` when packaged (extraResources / runtime). */
  readonly resourcesPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}): string {
  const env = options.env ?? process.env;
  const fromEnv = env[DESKTOP_HOST_NODE_ENV]?.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (!existsSync(resolved)) {
      throw new Error(
        `xrk desktop: ${DESKTOP_HOST_NODE_ENV} missing at ${resolved}`,
      );
    }
    return resolved;
  }

  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath?.trim();
    if (!resourcesPath) {
      throw new Error(
        "xrk desktop: packaged Host Node requires resourcesPath",
      );
    }
    const platform = options.platform ?? process.platform;
    const binary = path.join(
      resourcesPath,
      "runtime",
      "node",
      platform === "win32" ? "node.exe" : "node",
    );
    if (!existsSync(binary)) {
      throw new Error(
        `xrk desktop: bundled Node missing at ${binary} (run prepare:runtime)`,
      );
    }
    return binary;
  }

  throw new Error(
    `xrk desktop: set ${DESKTOP_HOST_NODE_ENV} to an upstream Node binary ` +
      "(not Electron execPath); `pnpm dev:desktop` sets this for the development projection",
  );
}

/**
 * Packaged Host entry written by electron-builder (`desktop-host/` from dist).
 * Prefers `app.asar.unpacked` so a real Node can load the script.
 */
export function resolveDesktopPackagedHostEntry(
  appPath: string,
  resourcesPath: string,
): string {
  const relative = path.join("desktop-host", "index.js");
  const unpacked = path.join(resourcesPath, "app.asar.unpacked", relative);
  if (existsSync(unpacked)) return unpacked;
  const nested = path.join(appPath, relative);
  if (existsSync(nested)) return nested;
  throw new Error(
    `xrk desktop: packaged Host entry missing (tried ${unpacked} and ${nested})`,
  );
}
