/**
 * host.openPath — open a filesystem path with the OS default application.
 * Win: cmd start · macOS: open · Linux: xdg-open.
 */

import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fullyQualified } from "./host-directory.js";
import type { FaceRpcResult } from "./types.js";

export function canOpenNativePath(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" || platform === "darwin" || platform === "linux";
}

function runDetached(
  command: string,
  args: readonly string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function openNativePath(
  target: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") {
    // Empty title argument required by `start`.
    await runDetached("cmd.exe", ["/c", "start", "", target]);
    return;
  }
  if (platform === "darwin") {
    await runDetached("open", [target]);
    return;
  }
  await runDetached("xdg-open", [target]);
}

export async function hostOpenPath(
  payload: unknown,
): Promise<FaceRpcResult<{ opened: true }>> {
  if (!canOpenNativePath()) {
    return {
      ok: false,
      error: {
        code: "not-implemented",
        message: "host.openPath unsupported on this platform",
      },
    };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "path required" },
    };
  }
  const path = String((payload as Record<string, unknown>).path ?? "").trim();
  if (!path) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "path required" },
    };
  }
  if (!fullyQualified(path)) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "path must be absolute",
      },
    };
  }
  try {
    await access(path, constants.F_OK);
  } catch {
    return {
      ok: false,
      error: { code: "not-found", message: `path not found: ${path}` },
    };
  }
  try {
    await openNativePath(path);
    return { ok: true, value: { opened: true } };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal",
        message: `path open failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}
