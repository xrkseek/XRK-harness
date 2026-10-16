/**
 * Cross-process exclusive write ownership for one sessions directory
 * (`sessions.db`). DSH uses per-session `session.lock`; XRK stores every
 * session in one SQLite file, so the lease guards the directory.
 *
 * Portable PID lockfile (no native flock addon): a live holder refuses a
 * second exclusive open; a crashed holder's stale file is stolen after the
 * PID check fails. Empty / unreadable lockfiles are treated as contended
 * (brief retry) — never stolen on first sight — to avoid dual writers during
 * the create window.
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
    const pidAlive =
      holderPid !== undefined ? isProcessAlive(holderPid) : false;
    const holderLine =
      holderPid !== undefined
        ? pidAlive
          ? ` Holder process PID ${String(holderPid)} is still running.`
          : ` Lock file names PID ${String(holderPid)}, but that process is gone.`
        : "";
    const tip = pidAlive
      ? " Quit other XRK Hosts (Desktop app, or `xrkh serve` / `xrkh web` in a terminal), then try again."
      : " No live holder was found — if this keeps happening, delete the lock file and start again.";
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

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM: process exists but we cannot signal it — treat as live.
    return code === "EPERM";
  }
}

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

/** Best-effort remove a lock whose holder is dead or missing. */
function unlinkStaleLock(lockPath: string): boolean {
  const holderPid = readHolderPid(lockPath);
  if (holderPid !== undefined && isProcessAlive(holderPid)) {
    return false;
  }
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/** Sync backoff without timers (lock acquire is sync). */
function spinWaitMs(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

/**
 * Acquire exclusive write ownership of `dir`.
 * Dead holder PIDs (crash / Cursor force-quit of a test Host) reclaim the
 * lock file automatically — no manual delete for the common case.
 * @throws {SessionsDirInUseError} when another live process (or this process)
 *   already holds the lease.
 */
export function acquireSessionsDirLock(dir: string): SessionsDirLock {
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true });

  const existing = localExclusive.get(root);
  if (existing) {
    throw new SessionsDirInUseError(root, process.pid);
  }

  const lockPath = path.join(root, SESSIONS_WRITE_LOCK_FILENAME);
  /** Attempts that saw an empty/unreadable lock before allowing a steal. */
  let emptySightings = 0;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      // Create + write PID in one call to shrink the empty-file window.
      writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
      if (readHolderPid(lockPath) !== process.pid) {
        // Path was replaced under us — drop and retry.
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
        continue;
      }
      let released = false;
      const lock: SessionsDirLock = {
        release() {
          if (released) return;
          released = true;
          localExclusive.delete(root);
          try {
            // Never unlink another holder's lease if we were stolen.
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
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      const holderPid = readHolderPid(lockPath);
      if (holderPid !== undefined && isProcessAlive(holderPid)) {
        throw new SessionsDirInUseError(root, holderPid);
      }
      if (holderPid === undefined) {
        // Contended create window or corrupt file — wait, do not steal yet.
        emptySightings += 1;
        if (emptySightings < 4) {
          spinWaitMs(15);
          continue;
        }
      }
      // Dead holder, or empty lock still after retries — remove and retry.
      unlinkStaleLock(lockPath);
      spinWaitMs(5);
    }
  }

  // Last chance: if the named PID is gone, force-unlink once more.
  const finalPid = readHolderPid(lockPath);
  if (finalPid === undefined || !isProcessAlive(finalPid)) {
    if (unlinkStaleLock(lockPath)) {
      try {
        writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
        if (readHolderPid(lockPath) === process.pid) {
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
      } catch {
        /* fall through to error */
      }
    }
  }

  throw new SessionsDirInUseError(root, readHolderPid(lockPath));
}
