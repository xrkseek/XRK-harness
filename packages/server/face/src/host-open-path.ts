/**
 * host.openPath / reveal — open or select a filesystem path in the OS shell.
 * Win: explorer /select · macOS: open -R · Linux: xdg-open (dir) / containing folder.
 */

import { access, constants, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fullyQualified } from "./host-directory.js";
import type { FaceRpcResult } from "./types.js";

/**
 * Whether Face may advertise `canOpenPath` / run `host.openPath`.
 * Desktop Host sets `XRK_NATIVE_OPEN=1` so the bit stays true without a second opener.
 */
export function canOpenNativePath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.XRK_NATIVE_OPEN === "1" || env.XRK_NATIVE_OPEN === "true") {
    return true;
  }
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

/** Normalize trailing `.` / separator noise from client path joins. */
export function normalizeOpenPath(target: string): string {
  let p = target.trim();
  // `C:\proj/.` or `/proj/.` → strip trailing slash-dot
  while (p.endsWith("/.") || p.endsWith("\\.")) {
    p = p.slice(0, -2);
  }
  while (
    (p.endsWith("/") || p.endsWith("\\")) &&
    p.length > 1 &&
    !/^[A-Za-z]:[\\/]?$/.test(p)
  ) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Win32 path for Explorer argv. Forward slashes must become `\`: Explorer
 * treats `/seg` after `/select,` as another switch, so reveal silently no-ops.
 */
export function windowsExplorerPath(target: string): string {
  return normalizeOpenPath(target).replace(/\//g, "\\");
}

export async function openNativePath(
  target: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const path =
    platform === "win32"
      ? windowsExplorerPath(target)
      : normalizeOpenPath(target);
  if (platform === "win32") {
    // Empty title argument required by `start`. Quote-safe via argv (no shell).
    await runDetached("cmd.exe", ["/c", "start", "", path]);
    return;
  }
  if (platform === "darwin") {
    await runDetached("open", [path]);
    return;
  }
  await runDetached("xdg-open", [path]);
}

/**
 * Reveal a path in the desktop file manager (select file when possible).
 */
export async function revealNativePath(
  target: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") {
    const path = windowsExplorerPath(target);
    // Directories: `/select` only highlights the folder in its parent and often
    // fails to focus when Explorer is already running (sidebar "open with"
    // Explorer on a folder looks like a no-op). Open the folder instead.
    try {
      if ((await stat(path)).isDirectory()) {
        await openNativePath(path, platform);
        return;
      }
    } catch {
      // Caller usually validated existence; fall through to /select.
    }
    // `/select,<path>` — no space after the comma (Explorer quirk).
    await runDetached("explorer.exe", [`/select,${path}`]);
    return;
  }
  const path = normalizeOpenPath(target);
  if (platform === "darwin") {
    await runDetached("open", ["-R", path]);
    return;
  }
  let st;
  try {
    st = await stat(path);
  } catch {
    await runDetached("xdg-open", [dirname(path)]);
    return;
  }
  await runDetached("xdg-open", [st.isDirectory() ? path : dirname(path)]);
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
  const body = payload as Record<string, unknown>;
  const path = normalizeOpenPath(String(body.path ?? ""));
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
  const reveal = body.reveal === true || body.mode === "reveal";
  try {
    if (reveal) {
      await revealNativePath(path);
    } else {
      await openNativePath(path);
    }
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
