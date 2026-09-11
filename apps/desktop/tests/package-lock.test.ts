import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireDesktopPackageLock,
  canReclaimDesktopPackageLock,
  isDesktopProcessAlive,
  readDesktopPackageLockOwner,
} from "../src/package-lock.js";
import { resolveDesktopPaths } from "../src/paths.js";
import { DesktopProfileTransactionManager } from "../src/profile-transaction.js";

describe("desktop package lock (orphan worker)", () => {
  it("treats the current process as alive and a bogus pid as reclaimable", () => {
    expect(isDesktopProcessAlive(process.pid)).toBe(true);
    // PIDs this high are extremely unlikely to be live on Windows/Unix test hosts.
    expect(isDesktopProcessAlive(2_147_483_647)).toBe(false);
  });

  it("refuses to reclaim a lock owned by a live process", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-lock-"));
    try {
      const paths = resolveDesktopPaths(home);
      mkdirSync(path.dirname(paths.lock), { recursive: true });
      writeFileSync(paths.lock, `${String(process.pid)}\n`);
      expect(readDesktopPackageLockOwner(paths.lock)).toBe(process.pid);
      expect(canReclaimDesktopPackageLock(paths.lock)).toBe(false);
      expect(() => acquireDesktopPackageLock(paths.lock)).toThrow(
        /another package transaction is active/u,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reclaims a lock whose owner pid is dead", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-lock-"));
    try {
      const paths = resolveDesktopPaths(home);
      mkdirSync(path.dirname(paths.lock), { recursive: true });
      writeFileSync(paths.lock, "2147483647\n");
      expect(canReclaimDesktopPackageLock(paths.lock)).toBe(true);
      const hold = acquireDesktopPackageLock(paths.lock);
      expect(readFileSync(paths.lock, "utf8")).toBe(`${String(process.pid)}\n`);
      // Hand off to a fake worker pid, then back to Electron — file must track owner.
      hold.assignOwner(4242);
      expect(readDesktopPackageLockOwner(paths.lock)).toBe(4242);
      hold.assignOwner(process.pid);
      expect(readDesktopPackageLockOwner(paths.lock)).toBe(process.pid);
      hold.release();
      expect(existsSync(paths.lock)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("assignPackageLockOwner requires an open transaction lock", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-lock-"));
    try {
      const paths = resolveDesktopPaths(home);
      const manager = new DesktopProfileTransactionManager(paths);
      expect(() => manager.assignPackageLockOwner(1)).toThrow(/lost its lock/u);
      await manager.withPackageLock(async () => {
        manager.assignPackageLockOwner(process.pid);
        expect(readDesktopPackageLockOwner(paths.lock)).toBe(process.pid);
      });
      expect(existsSync(paths.lock)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
