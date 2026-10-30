/**
 * host.openPath / reveal — open or select a filesystem path in the OS shell.
 * Also opens absolute URLs (http(s), custom schemes) in the registered handler.
 * Win folders: `cmd /c start` (ShellExecute). Win files: explorer /select.
 * macOS: open. Linux desktop: xdg-open. Termux: termux-open.
 */

import { access, constants, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fullyQualified } from "./host-directory.js";
import type { FaceRpcResult } from "./types.js";

/** Termux (Android) — has `termux-open`, not a desktop `xdg-open` session. */
export function isTermuxEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERMUX_VERSION !== undefined && env.TERMUX_VERSION !== "") return true;
  const prefix = env.PREFIX;
  return typeof prefix === "string" && prefix.includes("com.termux");
}

/**
 * Whether Face may advertise `canOpenPath` / run `host.openPath`.
 * Desktop Host sets `XRK_NATIVE_OPEN=1` so the bit stays true without a second opener.
 *
 * Linux is scenario-gated: GUI session (`DISPLAY` / `WAYLAND_DISPLAY`), Termux,
 * or the Desktop override — bare headless / CI Linux must not claim OS open.
 */
export function canOpenNativePath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.XRK_NATIVE_OPEN === "1" || env.XRK_NATIVE_OPEN === "true") {
    return true;
  }
  if (platform === "win32" || platform === "darwin") return true;
  if (platform === "linux") {
    if (isTermuxEnv(env)) return true;
    if (env.DISPLAY || env.WAYLAND_DISPLAY) return true;
    return false;
  }
  return false;
}

/**
 * Detached GUI/CLI spawn shared by openPath and open-in-app.
 * `windowsHide` defaults true (hide console stubs). Pass false for processes
 * that own the visible window (e.g. `wt`); GUI subsystem apps like
 * `explorer.exe` / `Cursor.exe` stay visible either way.
 */
export type SpawnDetachedFn = (
  command: string,
  args: readonly string[],
  options?: { readonly windowsHide?: boolean },
) => Promise<void>;

async function spawnDetachedDefault(
  command: string,
  args: readonly string[],
  options: { readonly windowsHide?: boolean } = {},
): Promise<void> {
  const windowsHide = options.windowsHide !== false;
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
      windowsHide,
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

let spawnDetachedImpl: SpawnDetachedFn = spawnDetachedDefault;

export function spawnDetached(
  command: string,
  args: readonly string[],
  options: { readonly windowsHide?: boolean } = {},
): Promise<void> {
  return spawnDetachedImpl(command, args, options);
}

/**
 * Test-only: replace detached spawn so unit tests never ShellExecute / open
 * Explorer (Win: deleting the temp dir after `cmd /c start` races and pops
 * "Windows cannot find the file"). Pass `undefined` to restore the default.
 */
export function installSpawnDetachedForTests(
  fn: SpawnDetachedFn | undefined,
): void {
  spawnDetachedImpl = fn ?? spawnDetachedDefault;
}

/** True for absolute URLs (`https://…`, `vscode://…`) — not filesystem paths. */
export function isAbsoluteUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target.trim());
}

/** Normalize trailing `.` / separator noise from client path joins. */
export function normalizeOpenPath(target: string): string {
  let p = target.trim();
  // `C:\proj/.` or `/proj/.` → strip trailing slash-dot
  while (p.endsWith("/.") || p.endsWith("\\.")) {
    p = p.slice(0, -2);
  }
  // `/.` must stay POSIX root; `C:\.` / `C:/.` must stay a drive root.
  if (p === "" && /^[\\/]/.test(target.trim())) {
    return "/";
  }
  if (/^[A-Za-z]:$/.test(p)) {
    const sep = target.includes("/") && !target.includes("\\") ? "/" : "\\";
    return `${p}${sep}`;
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
 * Must NOT be used on absolute URLs — that would turn `https://` into `https:\\`.
 */
export function windowsExplorerPath(target: string): string {
  return normalizeOpenPath(target).replace(/\//g, "\\");
}

async function openLinuxPath(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Termux first: Android intents via termux-open (xdg-open is usually absent).
  if (isTermuxEnv(env)) {
    await spawnDetached("termux-open", [path]);
    return;
  }
  await spawnDetached("xdg-open", [path]);
}

export async function openNativePath(
  target: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const raw = target.trim();
  // URLs keep forward slashes; Windows path mangling would break the scheme.
  if (isAbsoluteUrl(raw)) {
    if (platform === "win32") {
      await spawnDetached("cmd.exe", ["/c", "start", "", raw], {
        windowsHide: false,
      });
      return;
    }
    if (platform === "darwin") {
      await spawnDetached("open", [raw]);
      return;
    }
    await openLinuxPath(raw, env);
    return;
  }
  const path =
    platform === "win32"
      ? windowsExplorerPath(raw)
      : normalizeOpenPath(raw);
  if (platform === "win32") {
    // ShellExecute via `start`. Direct `explorer.exe <dir>` CreateProcess is a
    // no-op when Explorer is already the desktop shell (child exits 0, no window).
    // Empty title is required by `start`. windowsHide must be false: CREATE_NO_WINDOW
    // on this cmd also leaves the folder window unmapped.
    await spawnDetached("cmd.exe", ["/c", "start", "", path], {
      windowsHide: false,
    });
    return;
  }
  if (platform === "darwin") {
    await spawnDetached("open", [path]);
    return;
  }
  await openLinuxPath(path, env);
}

/**
 * Reveal a path in the desktop file manager (select file when possible).
 */
export async function revealNativePath(
  target: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (platform === "win32") {
    const path = windowsExplorerPath(target);
    // Directories: `/select` only highlights the folder in its parent and often
    // fails to focus when Explorer is already running (sidebar "open with"
    // Explorer on a folder looks like a no-op). Open the folder instead.
    try {
      if ((await stat(path)).isDirectory()) {
        await openNativePath(path, platform, env);
        return;
      }
    } catch {
      // Caller usually validated existence; fall through to /select.
    }
    // Files: bare `explorer.exe /select,…` CreateProcess is the same class of
    // no-op as opening a directory with explorer when the desktop shell is
    // already Explorer (child exits 0, no folder window). Route through
    // `cmd /c start` (ShellExecute) like openNativePath; windowsHide must be
    // false or the folder window stays unmapped. `/select,<path>` stays one
    // argv token — no space after the comma (Explorer quirk).
    await spawnDetached(
      "cmd.exe",
      ["/c", "start", "", "explorer.exe", `/select,${path}`],
      { windowsHide: false },
    );
    return;
  }
  const path = normalizeOpenPath(target);
  if (platform === "darwin") {
    await spawnDetached("open", ["-R", path]);
    return;
  }
  // Termux has no "reveal in folder" — open the path (or its parent) via intent.
  if (isTermuxEnv(env)) {
    let revealTarget = path;
    try {
      if (!(await stat(path)).isDirectory()) revealTarget = dirname(path);
    } catch {
      revealTarget = dirname(path);
    }
    await openLinuxPath(revealTarget, env);
    return;
  }
  let st;
  try {
    st = await stat(path);
  } catch {
    await spawnDetached("xdg-open", [dirname(path)]);
    return;
  }
  await spawnDetached("xdg-open", [st.isDirectory() ? path : dirname(path)]);
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
