import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireSessionsDirLock,
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

  it("steals a stale lock from a dead pid", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-stale-"));
    dirs.push(dir);
    // Unlikely to be a live process on any host.
    writeFileSync(path.join(dir, SESSIONS_WRITE_LOCK_FILENAME), "2147483646\n");
    const lock = acquireSessionsDirLock(dir);
    locks.push(lock);
    expect(lock).toBeDefined();
  });

  it("retries before stealing an empty lockfile", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-empty-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, SESSIONS_WRITE_LOCK_FILENAME), "");
    const t0 = Date.now();
    const lock = acquireSessionsDirLock(dir);
    locks.push(lock);
    // Three contended waits (~15ms) before steal — not an instant unlink.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40);
  });

  it("release does not unlink another holder's lock file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-release-"));
    dirs.push(dir);
    const lock = acquireSessionsDirLock(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    // Simulate steal: replace on-disk lease with another pid text.
    writeFileSync(lockPath, "2147483646\n");
    lock.release();
    expect(readFileSync(lockPath, "utf8").trim()).toBe("2147483646");
  });

  it("user message tells operators to quit other Hosts", () => {
    const err = new SessionsDirInUseError("/tmp/x", 42);
    expect(err.message).toMatch(/Quit other running XRK instances/);
    expect(err.code).toBe("sessions-dir-in-use");
    expect(err.holderPid).toBe(42);
  });
});
