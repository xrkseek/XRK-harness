/**
 * Desktop package transaction lock (ADR-0008 · install ownership).
 *
 * Electron process-lifetime single-instance lock is the primary Desktop owner.
 * This file lock is defense-in-depth: while a package worker (e.g. bundled pnpm)
 * may still write, the lock records that worker PID so a later process does not
 * treat a live orphan worker as a stale transaction and reclaim the lock.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

/** Probe whether `pid` still exists (signal 0). */
export function isDesktopProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Read the PID recorded in a package lock file; invalid content → undefined. */
export function readDesktopPackageLockOwner(lockPath: string): number | undefined {
  if (!existsSync(lockPath)) return undefined;
  const lock = lstatSync(lockPath);
  if (lock.isSymbolicLink() || !lock.isFile()) {
    throw new Error(
      `xrk desktop package lock: ${lockPath} is not a regular file`,
    );
  }
  const owner = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
  if (!Number.isSafeInteger(owner) || owner <= 0) return undefined;
  return owner;
}

/**
 * Whether an existing lock may be unlinked as stale.
 * Live owners (Electron or package worker) must not be treated as orphans.
 */
export function canReclaimDesktopPackageLock(lockPath: string): boolean {
  const owner = readDesktopPackageLockOwner(lockPath);
  if (owner === undefined) return true;
  return !isDesktopProcessAlive(owner);
}

/** Write / rewrite the lock owner PID on an open exclusive descriptor. */
export function writeDesktopPackageLockOwner(
  lockDescriptor: number,
  pid: number,
): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(
      `xrk desktop package lock: invalid owner pid ${String(pid)}`,
    );
  }
  const content = Buffer.from(`${String(pid)}\n`);
  ftruncateSync(lockDescriptor, 0);
  writeSync(lockDescriptor, content, 0, content.byteLength, 0);
  fsyncSync(lockDescriptor);
}

export interface DesktopPackageLockHold {
  readonly descriptor: number;
  readonly lockPath: string;
  /** Record Electron or a live package worker as the current owner. */
  assignOwner(pid: number): void;
  /** Close descriptor and unlink the lock file. */
  release(): void;
}

/**
 * Acquire `lockPath` exclusively.
 * Reclaims only when the recorded owner is dead or the file is corrupt —
 * never when a live orphan worker still holds the PID.
 */
export function acquireDesktopPackageLock(
  lockPath: string,
  options: { readonly initialOwnerPid?: number } = {},
): DesktopPackageLockHold {
  const resolved = path.resolve(lockPath);
  mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  let descriptor: number;
  try {
    descriptor = openSync(resolved, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    if (!canReclaimDesktopPackageLock(resolved)) {
      const owner = readDesktopPackageLockOwner(resolved);
      throw new Error(
        `xrk desktop package lock: another package transaction is active` +
          (owner === undefined ? "" : ` (owner pid ${String(owner)})`),
        { cause: error },
      );
    }
    unlinkSync(resolved);
    descriptor = openSync(resolved, "wx", 0o600);
  }
  const hold: DesktopPackageLockHold = {
    descriptor,
    lockPath: resolved,
    assignOwner(pid: number): void {
      writeDesktopPackageLockOwner(descriptor, pid);
    },
    release(): void {
      try {
        closeSync(descriptor);
      } catch {
        // already closed
      }
      try {
        unlinkSync(resolved);
      } catch {
        // best-effort
      }
    },
  };
  hold.assignOwner(options.initialOwnerPid ?? process.pid);
  return hold;
}
