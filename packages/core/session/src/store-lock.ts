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
 */
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
 * Another Host (or process) already holds the exclusive write lease.
 * Message names the lock file so zero-experience users know what blocked boot.
 */
export class SessionsDirInUseError extends Error {
  readonly code = "sessions-dir-in-use" as const;
  readonly dir: string;
  readonly lockPath: string;
  readonly holderPid: number | undefined;

  constructor(dir: string, holderPid?: number) {
    const root = path.resolve(dir);
    const lockPath = path.join(root, SESSIONS_WRITE_LOCK_FILENAME);
    const holderLine =
      holderPid !== undefined
        ? ` Lock file names PID ${String(holderPid)}.`
        : "";
    const tip =
      " Quit other XRK Hosts (Desktop app, or `xrkh serve` / `xrkh web` in a terminal)." +
      " If that Host already exited, delete the lock file and try again.";
    super(
      `Session store lock: data folder already in use.${holderLine}${tip}\nLock file: ${lockPath}`,
    );
    this.name = "SessionsDirInUseError";
    this.dir = root;
    this.lockPath = lockPath;
    this.holderPid = holderPid;
  }
}

export interface SessionsDirLock {
  release(): void;
}

/** In-process exclusive holders keyed by resolved directory. */
const localExclusive = new Map<string, SessionsDirLock>();

function readHolderPid(lockPath: string): number | undefined {
  try {
    const text = readFileSync(lockPath, "utf8").trim();
    if (!text) return undefined;
    const n = Number(text.split(/\s+/)[0]);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
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

/**
 * If the lock names a dead PID, unlink once when the content is unchanged.
 * @returns whether the file was removed
 */
function tryReclaimDeadHolder(lockPath: string): boolean {
  const holder = readHolderPid(lockPath);
  if (holder === undefined) return false;
  if (isSessionsLockHolderAlive(holder)) return false;
  try {
    if (readHolderPid(lockPath) !== holder) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function createExclusiveLock(root: string, lockPath: string): SessionsDirLock {
  writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });

  if (readHolderPid(lockPath) !== process.pid) {
    // Replaced under us — do not steal; surface contention.
    throw new SessionsDirInUseError(root, readHolderPid(lockPath));
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

/**
 * Acquire exclusive write ownership of `dir`.
 * @throws {SessionsDirInUseError} when another **live** process (or this
 *   process) already holds the lease. A dead holder's stale lockfile is
 *   reclaimed once, then create retries.
 */
export function acquireSessionsDirLock(dir: string): SessionsDirLock {
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true });

  const existing = localExclusive.get(root);
  if (existing) {
    throw new SessionsDirInUseError(root, process.pid);
  }

  const lockPath = path.join(root, SESSIONS_WRITE_LOCK_FILENAME);

  try {
    return createExclusiveLock(root, lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
  }

  // Live holder or empty/unreadable → refuse. Dead PID → reclaim once + retry.
  if (!tryReclaimDeadHolder(lockPath)) {
    throw new SessionsDirInUseError(root, readHolderPid(lockPath));
  }

  try {
    return createExclusiveLock(root, lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || err instanceof SessionsDirInUseError) {
      throw new SessionsDirInUseError(root, readHolderPid(lockPath));
    }
    throw err;
  }
}
