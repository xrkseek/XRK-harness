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
import { describe, expect, it, vi } from "vitest";
import { DESKTOP_HOST_PACKAGE } from "../src/core-package-set.js";
import { resolveDesktopPaths } from "../src/paths.js";
import {
  DesktopProfileTransactionManager,
  defaultDesktopProfileHealthCheck,
  type DesktopProfileHooks,
} from "../src/profile-transaction.js";

function writeHostEntry(profileDir: string): void {
  const entry = path.join(
    profileDir,
    "node_modules",
    ...DESKTOP_HOST_PACKAGE.split("/"),
    "dist",
    "index.js",
  );
  mkdirSync(path.dirname(entry), { recursive: true });
  writeFileSync(entry, "export {}\n");
}

function hooks(overrides: Partial<DesktopProfileHooks> = {}): DesktopProfileHooks {
  return {
    healthCheck: async (dir) => {
      await defaultDesktopProfileHealthCheck(dir);
    },
    beforeActivate: async () => undefined,
    afterActivate: async () => undefined,
    ...overrides,
  };
}

describe("DesktopProfileTransactionManager", () => {
  it("activates staging after health check (first install)", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-tx-"));
    try {
      const paths = resolveDesktopPaths(home);
      const manager = new DesktopProfileTransactionManager(paths);
      const staging = manager.createStagingProfile();
      writeHostEntry(staging);
      writeFileSync(path.join(staging, "marker.txt"), "v1");

      await manager.runTransaction(staging, hooks());

      expect(existsSync(paths.profile)).toBe(true);
      expect(readFileSync(path.join(paths.profile, "marker.txt"), "utf8")).toBe(
        "v1",
      );
      expect(existsSync(paths.pending)).toBe(false);
      expect(existsSync(staging)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rolls active profile aside then replaces; recover restores interrupted swap", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-tx-"));
    try {
      const paths = resolveDesktopPaths(home);
      const manager = new DesktopProfileTransactionManager(paths);

      const first = manager.createStagingProfile();
      writeHostEntry(first);
      writeFileSync(path.join(first, "marker.txt"), "v1");
      await manager.runTransaction(first, hooks());

      const second = manager.createStagingProfile();
      writeHostEntry(second);
      writeFileSync(path.join(second, "marker.txt"), "v2");
      await manager.runTransaction(second, hooks());
      expect(readFileSync(path.join(paths.profile, "marker.txt"), "utf8")).toBe(
        "v2",
      );

      // Simulate crash after active-moved: clear prior rollback, move profile aside, journal pending
      const crashStaging = manager.createStagingProfile();
      writeHostEntry(crashStaging);
      writeFileSync(path.join(crashStaging, "marker.txt"), "v3");
      const { renameSync, rmSync: rm } = await import("node:fs");
      rm(paths.rollback, { recursive: true, force: true });
      mkdirSync(path.dirname(paths.rollback), { recursive: true });
      renameSync(paths.profile, paths.rollback);
      writeFileSync(
        paths.pending,
        `${JSON.stringify({
          schemaVersion: 1,
          id: path.basename(path.dirname(crashStaging)),
          stagingProfile: crashStaging,
          step: "active-moved",
        }, undefined, 2)}\n`,
      );

      manager.recover();
      expect(existsSync(paths.pending)).toBe(false);
      expect(readFileSync(path.join(paths.profile, "marker.txt"), "utf8")).toBe(
        "v2",
      );
      expect(existsSync(crashStaging)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not activate when health check fails", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-tx-"));
    try {
      const paths = resolveDesktopPaths(home);
      const manager = new DesktopProfileTransactionManager(paths);
      const staging = manager.createStagingProfile();
      writeFileSync(path.join(staging, "marker.txt"), "bad");

      await expect(
        manager.runTransaction(staging, hooks()),
      ).rejects.toThrow(/health check failed/u);
      expect(existsSync(paths.profile)).toBe(false);
      expect(existsSync(staging)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("restores previous profile when afterActivate fails", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-tx-"));
    try {
      const paths = resolveDesktopPaths(home);
      const manager = new DesktopProfileTransactionManager(paths);

      const first = manager.createStagingProfile();
      writeHostEntry(first);
      writeFileSync(path.join(first, "marker.txt"), "keep");
      await manager.runTransaction(first, hooks());

      const second = manager.createStagingProfile();
      writeHostEntry(second);
      writeFileSync(path.join(second, "marker.txt"), "fail");
      const afterActivate = vi
        .fn()
        .mockRejectedValueOnce(new Error("boot failed"))
        .mockResolvedValue(undefined);

      await expect(
        manager.runTransaction(
          second,
          hooks({ afterActivate }),
        ),
      ).rejects.toThrow(/boot failed/u);

      expect(readFileSync(path.join(paths.profile, "marker.txt"), "utf8")).toBe(
        "keep",
      );
      expect(existsSync(paths.pending)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
