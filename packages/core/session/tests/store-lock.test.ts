import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireSessionsDirLock,
  isSessionsLockHolderAlive,
  isSessionsLockHolderLiveHost,
  looksLikeSessionsLockHost,
  peekSessionsLockHolderKind,
  SessionsDirInUseError,
  SESSIONS_LOCK_HOLDER_KIND,
  SESSIONS_LOCK_RECLAIM_ENV,
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

  it("writes holder kind beside the pid", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-kind-"));
    dirs.push(dir);
    locks.push(acquireSessionsDirLock(dir));
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    expect(peekSessionsLockHolderKind(lockPath)).toBe(SESSIONS_LOCK_HOLDER_KIND);
    expect(readFileSync(lockPath, "utf8")).toMatch(
      new RegExp(`^${String(process.pid)}\\n${SESSIONS_LOCK_HOLDER_KIND}\\n`),
    );
  });

  it("reclaims a stale lock when the named pid is dead", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-stale-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    // PID unlikely to exist; probe must report dead or the case is skipped.
    const deadPid = 2147483646;
    expect(isSessionsLockHolderAlive(deadPid)).toBe(false);
    writeFileSync(lockPath, `${String(deadPid)}\n${SESSIONS_LOCK_HOLDER_KIND}\n`);
    const lock = acquireSessionsDirLock(dir);
    locks.push(lock);
    expect(readFileSync(lockPath, "utf8").trim().split(/\r?\n/)[0]).toBe(
      String(process.pid),
    );
  });

  it("reclaims when pid is alive but cmdline is not Host-shaped", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-foreign-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    writeFileSync(lockPath, "4242\n");
    const lock = acquireSessionsDirLock(dir, {
      isAlive: () => true,
      readCmdline: () => "/system/bin/surfaceflinger",
    });
    locks.push(lock);
    expect(readFileSync(lockPath, "utf8").trim().split(/\r?\n/)[0]).toBe(
      String(process.pid),
    );
  });

  it("refuses to steal when the named pid is a live Host", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-live-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    writeFileSync(lockPath, `${String(process.pid)}\n${SESSIONS_LOCK_HOLDER_KIND}\n`);
    expect(() => acquireSessionsDirLock(dir)).toThrow(SessionsDirInUseError);
    expect(readFileSync(lockPath, "utf8").trim().split(/\r?\n/)[0]).toBe(
      String(process.pid),
    );
  });

  it("refuses an empty lockfile instead of stealing it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-empty-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, SESSIONS_WRITE_LOCK_FILENAME), "");
    expect(() => acquireSessionsDirLock(dir)).toThrow(SessionsDirInUseError);
  });

  it("phone reclaim force-unlinks a leftover empty lock after a short wait", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-phone-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    writeFileSync(lockPath, "");
    let slept = 0;
    const lock = acquireSessionsDirLock(dir, {
      env: { [SESSIONS_LOCK_RECLAIM_ENV]: "1" },
      sleepMs: (ms) => {
        slept = ms;
      },
    });
    locks.push(lock);
    expect(slept).toBeGreaterThan(0);
    expect(readFileSync(lockPath, "utf8").trim().split(/\r?\n/)[0]).toBe(
      String(process.pid),
    );
  });

  it("phone reclaim does not steal a live Host-shaped holder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-phone-live-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    writeFileSync(lockPath, "9999\n");
    expect(() =>
      acquireSessionsDirLock(dir, {
        env: { [SESSIONS_LOCK_RECLAIM_ENV]: "1" },
        isAlive: () => true,
        readCmdline: () => "/opt/node/bin/node /usr/local/bin/xrkh web",
        sleepMs: () => undefined,
      }),
    ).toThrow(SessionsDirInUseError);
    expect(readFileSync(lockPath, "utf8").trim()).toBe("9999");
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
    const err = new SessionsDirInUseError("/tmp/x", 42, { holderLooksLive: true });
    expect(err.message).toMatch(/Session store lock/);
    expect(err.message).toMatch(/PID 42/);
    expect(err.message).toMatch(/sessions\.write\.lock/);
    expect(err.code).toBe("sessions-dir-in-use");
    expect(err.holderPid).toBe(42);
    expect(err.holderLooksLive).toBe(true);
  });

  it("classifies Host-shaped cmdlines across surfaces", () => {
    expect(looksLikeSessionsLockHost("/opt/node/bin/node xrkh web")).toBe(true);
    expect(looksLikeSessionsLockHost("C:\\Program Files\\XRK\\electron.exe")).toBe(
      true,
    );
    expect(looksLikeSessionsLockHost("node.exe")).toBe(true);
    expect(looksLikeSessionsLockHost("harness-desktop-host.exe")).toBe(true);
    expect(looksLikeSessionsLockHost("/system/bin/surfaceflinger")).toBe(false);
    // Path-only node_modules must not look like a Host (Windows/Linux PID reuse).
    expect(
      looksLikeSessionsLockHost("/usr/bin/python /home/u/proj/node_modules/x"),
    ).toBe(false);
    expect(
      isSessionsLockHolderLiveHost(1, {
        isAlive: () => true,
        readCmdline: () => "chrome --type=renderer",
      }),
    ).toBe(false);
  });

  it("reclaims when Windows-style image name is not Host-shaped", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-win-img-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    writeFileSync(lockPath, "4242\nxrkh-host\n");
    const lock = acquireSessionsDirLock(dir, {
      isAlive: () => true,
      readCmdline: () => "notepad.exe",
    });
    locks.push(lock);
    expect(readFileSync(lockPath, "utf8").trim().split(/\r?\n/)[0]).toBe(
      String(process.pid),
    );
  });

  it("keeps kill(0) semantics when identity is unavailable", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sess-no-id-"));
    dirs.push(dir);
    const lockPath = path.join(dir, SESSIONS_WRITE_LOCK_FILENAME);
    writeFileSync(lockPath, "4242\n");
    expect(() =>
      acquireSessionsDirLock(dir, {
        isAlive: () => true,
        readCmdline: () => undefined,
      }),
    ).toThrow(SessionsDirInUseError);
    expect(readFileSync(lockPath, "utf8").trim()).toBe("4242");
  });
});
