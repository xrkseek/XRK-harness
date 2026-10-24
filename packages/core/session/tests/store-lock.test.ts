import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireSessionsDirLock,
  isSessionsLockHolderAlive,
  SessionsDirInUseError,
  SESSIONS_WRITE_LOCK_FILENAME,
} from "../src/store-lock.js";

const dirs: string[] = [];
const locks: Array<{ release(): void }> = [];

afterEach(() => {
  while (locks.length > 0) locks.pop()!.release();
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("sessions dir write lock", () => {
  it("excludes a second exclusive acquire in-process", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-lock-"));
    dirs.push(dir);
    locks.push(acquireSessionsDirLock(dir));
    expect(() => acquireSessionsDirLock(dir)).toThrow(SessionsDirInUseError);
  });

  it("reclaims a stale lock when the named pid is dead", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-stale-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    // PID unlikely to exist; probe must report dead or the case is skipped.
    const deadPid = 2147483646;
    expect(isSessionsLockHolderAlive(deadPid)).toBe(false);
    writeFileSync(lockPath, `${String(deadPid)}\n`);
    const lock = acquireSessionsDirLock(dir);
    locks.push(lock);
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });

  it("refuses to steal when the named pid is still alive", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-live-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    // Our pid is alive, but we are not the in-process holder — must not steal.
    writeFileSync(lockPath, `${String(process.pid)}\n`);
    expect(() => acquireSessionsDirLock(dir)).toThrow(SessionsDirInUseError);
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });

  it("refuses an empty lockfile instead of stealing it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-empty-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, SESSIONS_WRITE_LOCK_FILENAME), "");
    expect(() => acquireSessionsDirLock(dir)).toThrow(SessionsDirInUseError);
  });

  it("release does not unlink another holder's lock file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-release-"));
    dirs.push(dir);
    const lock = acquireSessionsDirLock(dir);
    locks.push(lock);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    writeFileSync(lockPath, "2147483646\n");
    lock.release();
    expect(readFileSync(lockPath, "utf8").trim()).toBe("2147483646");
  });

  it("error message tells operators to quit other Hosts", () => {
    const err = new SessionsDirInUseError("/tmp/x", 42);
    expect(err.message).toMatch(/Session store lock/);
    expect(err.message).toMatch(/PID 42/);
    expect(err.message).toMatch(/sessions\.write\.lock/);
    expect(err.code).toBe("sessions-dir-in-use");
    expect(err.holderPid).toBe(42);
  });
});
