/**
 * Cross-process exclusive write ownership for one sessions directory
 * (`sessions.db`). DSH uses per-session `session.lock`; XRK stores every
 * session in one SQLite file, so the lease guards the directory.
 *
 * Portable lockfile with **no PID steal**. A second writer that sees an
 * existing lock always gets {@link SessionsDirInUseError} — even when the
 * named PID looks dead. PID reuse on Windows would otherwise tear concurrent
 * SQLite writers. Crash reclaim is operator-visible (delete the lock file /
 * quit the other Host); a future kernel mutex can auto-reclaim without
 * reintroducing steal-by-PID.
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

/**
 * Acquire exclusive write ownership of `dir`.
 * @throws {SessionsDirInUseError} when another process (or this process)
 *   already holds the lease — never steals a lockfile by PID liveness.
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
    writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new SessionsDirInUseError(root, readHolderPid(lockPath));
    }
    throw err;
  }

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
