/**
 * Cross-process exclusive write ownership for one sessions directory
 * (`sessions.db`). DSH uses per-session `session.lock`; XRK stores every
 * session in one SQLite file, so the lease guards the directory.
 *
 * Portable lockfile: a second live writer always gets
 * {@link SessionsDirInUseError}. A **dead** holder's PID (crash / hard kill
 * without `release`) is cleared **once** then the acquire retries — matching
 * Desktop "close the window and reopen" UX. Empty / unreadable locks are not
 * stolen (create-window race). `EPERM` on the liveness probe counts as alive
 * so we never steal a process we cannot signal.
 *
 * Identity: the lockfile's second line is {@link SESSIONS_LOCK_HOLDER_KIND}.
 * When a process image / cmdline is readable and does **not** look like a Host
 * (`node` / `xrkh` / Electron), the PID is treated as a false-alive reuse and
 * the lock may be reclaimed once — proot and PID-recycle edges.
 * - POSIX: `/proc/<pid>/cmdline`
 * - Windows: `tasklist` image name (contention path only)
 *
 * Phone guest injects {@link SESSIONS_LOCK_RECLAIM_ENV}=1: after a short wait,
 * one forced unlink+retry (single Host; shell already clears locks on start).
 * Desktop / multi-Host must omit that env — force reclaim never runs against a
 * still Host-shaped live holder.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Lock file beside `sessions.db`. */
export const SESSIONS_WRITE_LOCK_FILENAME = "sessions.write.lock";

/**
 * Second line of a Host-written lockfile. Older locks may be PID-only.
 * Presence lets reclaim distinguish "our" writers from bare PID files.
 */
export const SESSIONS_LOCK_HOLDER_KIND = "xrkh-host";

/**
 * Phone guest sets this to `1` so a leftover lock after hard-kill / APK
 * replace can be force-reclaimed once. Desktop / multi-Host must omit it.
 */
export const SESSIONS_LOCK_RECLAIM_ENV = "XRK_SESSIONS_LOCK_RECLAIM";

const RECLAIM_WAIT_MS = 200;

/**
 * Another Host (or process) already holds the exclusive write lease.
 * Message names the lock file so zero-experience users know what blocked boot.
 */
export class SessionsDirInUseError extends Error {
  readonly code = "sessions-dir-in-use" as const;
  readonly dir: string;
  readonly lockPath: string;
  readonly holderPid: number | undefined;
  /** True when the holder still looks like a live XRK Host. */
  readonly holderLooksLive: boolean;

  constructor(
    dir: string,
    holderPid?: number,
    options?: { holderLooksLive?: boolean; phoneReclaim?: boolean },
  ) {
    const root = path.resolve(dir);
    const lockPath = path.join(root, SESSIONS_WRITE_LOCK_FILENAME);
    const holderLooksLive = options?.holderLooksLive === true;
    const holderLine =
      holderPid !== undefined
        ? ` Lock file names PID ${String(holderPid)}.`
        : "";
    const tip = options?.phoneReclaim
      ? " Phone guest already clears writer locks before spawn; if this persists, force-stop the app and open it again."
      : holderLooksLive
        ? " Quit other XRK Hosts (Desktop app, or `xrkh serve` / `xrkh web` in a terminal)."
        : " If that Host already exited, delete the lock file and try again." +
          " Quit other XRK Hosts (Desktop app, or `xrkh serve` / `xrkh web` in a terminal) when a second instance is intentional.";
    super(
      `Session store lock: data folder already in use.${holderLine}${tip}\nLock file: ${lockPath}`,
    );
    this.name = "SessionsDirInUseError";
    this.dir = root;
    this.lockPath = lockPath;
    this.holderPid = holderPid;
    this.holderLooksLive = holderLooksLive;
  }
}

export interface SessionsDirLock {
  release(): void;
}

/** Optional probes for tests; production uses OS defaults. */
export interface SessionsDirLockProbes {
  readonly isAlive?: (pid: number) => boolean;
  readonly readCmdline?: (pid: number) => string | undefined;
  readonly env?: NodeJS.ProcessEnv;
  readonly sleepMs?: (ms: number) => void;
}

/** In-process exclusive holders keyed by resolved directory. */
const localExclusive = new Map<string, SessionsDirLock>();

function readLockText(lockPath: string): string | undefined {
  try {
    return readFileSync(lockPath, "utf8");
  } catch {
    return undefined;
  }
}

function readHolderPid(lockPath: string): number | undefined {
  const text = readLockText(lockPath)?.trim();
  if (!text) return undefined;
  const n = Number(text.split(/\s+/)[0]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function readHolderKind(lockPath: string): string | undefined {
  const text = readLockText(lockPath);
  if (!text) return undefined;
  const kind = text.split(/\r?\n/)[1]?.trim();
  return kind || undefined;
}

/** True when the OS still has a process for `pid` (or we lack rights to ask). */
export function isSessionsLockHolderAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Exists but we cannot signal it — treat as live; never steal.
    if (code === "EPERM") return true;
    return false;
  }
}

function readPosixCmdline(pid: number): string | undefined {
  try {
    const raw = readFileSync(`/proc/${String(pid)}/cmdline`);
    const text = raw.toString("utf8").replace(/\0/g, " ").trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Windows image name for `pid` via `tasklist` (contention path only).
 * Returns undefined when the process is gone or tasklist is unavailable.
 */
function readWindowsImageName(pid: number): string | undefined {
  try {
    const out = execFileSync(
      "tasklist",
      ["/FI", `PID eq ${String(pid)}`, "/FO", "CSV", "/NH"],
      {
        encoding: "utf8",
        timeout: 2_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    // No match → "INFO: No tasks are running which match the specified criteria."
    if (!out || !out.startsWith('"')) return undefined;
    const image = out.split(",", 1)[0]?.replace(/^"|"$/g, "").trim();
    return image || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort process identity for `pid`.
 * POSIX: `/proc/<pid>/cmdline`. Windows: `tasklist` image name.
 */
export function readSessionsLockHolderCmdline(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "win32") return readWindowsImageName(pid);
  return readPosixCmdline(pid);
}

/**
 * Host-shaped argv / image (node · xrkh · Electron Desktop).
 * Word-boundary tokens so a path containing only `node_modules` does not
 * count as a Host (PID-reuse reclaim must still proceed).
 */
export function looksLikeSessionsLockHost(cmdline: string): boolean {
  const lower = cmdline.toLowerCase().replace(/\\/g, "/");
  // `\bnode\b` does not match `node_modules` (`_` is a word char).
  if (/\b(node|nodejs|electron|xrkh)(\.exe)?\b/.test(lower)) return true;
  return (
    lower.includes("xrk-harness") ||
    lower.includes("harness-desktop") ||
    lower.includes("harness-cli") ||
    lower.includes("harness-desktop-host")
  );
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function phoneReclaimEnabled(env: NodeJS.ProcessEnv): boolean {
  return String(env[SESSIONS_LOCK_RECLAIM_ENV] ?? "").trim() === "1";
}

/**
 * Live Host = OS says alive **and** (when identity is visible) it still looks
 * like node/xrkh/Electron. Missing identity keeps kill(0) semantics.
 */
export function isSessionsLockHolderLiveHost(
  pid: number,
  probes?: SessionsDirLockProbes,
): boolean {
  // Same-process holder: never reclaim via identity probes (skip tasklist).
  if (pid === process.pid) return true;
  const alive = probes?.isAlive ?? isSessionsLockHolderAlive;
  if (!alive(pid)) return false;
  const readCmd = probes?.readCmdline ?? readSessionsLockHolderCmdline;
  const cmdline = readCmd(pid);
  if (cmdline === undefined) return true;
  return looksLikeSessionsLockHost(cmdline);
}

/**
 * If the lock names a dead or foreign (non-Host) PID, unlink once when the
 * content is unchanged.
 * @returns whether the file was removed
 */
function tryReclaimStaleHolder(
  lockPath: string,
  probes?: SessionsDirLockProbes,
): boolean {
  const holder = readHolderPid(lockPath);
  if (holder === undefined) return false;
  if (isSessionsLockHolderLiveHost(holder, probes)) return false;
  try {
    if (readHolderPid(lockPath) !== holder) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function forceUnlinkOnce(lockPath: string): boolean {
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function lockPayload(): string {
  return `${process.pid}\n${SESSIONS_LOCK_HOLDER_KIND}\n`;
}

function createExclusiveLock(root: string, lockPath: string): SessionsDirLock {
  writeFileSync(lockPath, lockPayload(), { flag: "wx" });

  if (readHolderPid(lockPath) !== process.pid) {
    throw new SessionsDirInUseError(root, readHolderPid(lockPath), {
      holderLooksLive: true,
    });
  }

  let released = false;
  const lock: SessionsDirLock = {
    release() {
      if (released) return;
      released = true;
      localExclusive.delete(root);
      try {
        if (readHolderPid(lockPath) === process.pid) {
          unlinkSync(lockPath);
        }
      } catch {
        /* ignore */
      }
    },
  };
  localExclusive.set(root, lock);
  return lock;
}

function refuse(
  root: string,
  lockPath: string,
  probes: SessionsDirLockProbes | undefined,
  phone: boolean,
): never {
  const holder = readHolderPid(lockPath);
  const live =
    holder !== undefined && isSessionsLockHolderLiveHost(holder, probes);
  throw new SessionsDirInUseError(root, holder, {
    holderLooksLive: live,
    phoneReclaim: phone,
  });
}

function tryCreateOrRefuse(
  root: string,
  lockPath: string,
  probes: SessionsDirLockProbes | undefined,
  phone: boolean,
): SessionsDirLock {
  try {
    return createExclusiveLock(root, lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || err instanceof SessionsDirInUseError) {
      refuse(root, lockPath, probes, phone);
    }
    throw err;
  }
}

/**
 * Phone single-writer: short wait, then reclaim stale/empty once (never a live
 * Host-shaped holder).
 */
function tryPhoneForceReclaim(
  lockPath: string,
  probes: SessionsDirLockProbes | undefined,
  sleep: (ms: number) => void,
): boolean {
  sleep(RECLAIM_WAIT_MS);
  if (tryReclaimStaleHolder(lockPath, probes)) return true;
  const holder = readHolderPid(lockPath);
  if (holder !== undefined && isSessionsLockHolderLiveHost(holder, probes)) {
    return false;
  }
  // Empty / unreadable / foreign — phone shell owns guest lifecycle.
  return forceUnlinkOnce(lockPath);
}

/**
 * Acquire exclusive write ownership of `dir`.
 * @throws {SessionsDirInUseError} when another **live Host-shaped** process
 *   (or this process) already holds the lease. A dead / foreign holder's
 *   stale lockfile is reclaimed once, then create retries. With
 *   {@link SESSIONS_LOCK_RECLAIM_ENV}=1, one short wait + force unlink retries.
 */
export function acquireSessionsDirLock(
  dir: string,
  probes?: SessionsDirLockProbes,
): SessionsDirLock {
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true });

  const existing = localExclusive.get(root);
  if (existing) {
    throw new SessionsDirInUseError(root, process.pid, {
      holderLooksLive: true,
    });
  }

  const lockPath = path.join(root, SESSIONS_WRITE_LOCK_FILENAME);
  const env = probes?.env ?? process.env;
  const phone = phoneReclaimEnabled(env);
  const sleep = probes?.sleepMs ?? sleepSync;

  try {
    return createExclusiveLock(root, lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
  }

  if (tryReclaimStaleHolder(lockPath, probes)) {
    return tryCreateOrRefuse(root, lockPath, probes, phone);
  }

  if (phone && tryPhoneForceReclaim(lockPath, probes, sleep)) {
    return tryCreateOrRefuse(root, lockPath, probes, phone);
  }

  refuse(root, lockPath, probes, phone);
}

/** @internal test helper — exported kind reader for assertions. */
export function peekSessionsLockHolderKind(
  lockPath: string,
): string | undefined {
  return readHolderKind(lockPath);
}
