import { describe, expect, it, vi } from "vitest";
import { DESKTOP_HOST_PROTOCOL_VERSION } from "../src/host-protocol.js";
import {
  DESKTOP_BUNDLED_NODE_VERSION,
  DESKTOP_BUNDLED_PNPM_VERSION,
} from "../src/prepare-runtime.js";
import {
  assertDesktopUpdateUnit,
  createDesktopRelease,
  DESKTOP_UPDATE_MVP_MODE,
  DESKTOP_UPDATE_PHASE2_DEFERRED,
  DESKTOP_UPDATE_UNIT_PARTS,
  isDesktopUpdatePhase2Deferred,
  parseDesktopRelease,
  resolveDesktopUpdateMvpMode,
} from "../src/release.js";
import {
  DesktopUpdateCoordinator,
  type DesktopAppUpdater,
} from "../src/update-coordinator.js";
import type { DesktopUpdateState } from "../src/ipc.js";

describe("desktop release / update unit", () => {
  it("accepts one exact release identity for shell, runtime, and seed", () => {
    expect(
      parseDesktopRelease({
        schemaVersion: 1,
        version: "1.2.3",
        hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        nodeVersion: DESKTOP_BUNDLED_NODE_VERSION,
        pnpmVersion: DESKTOP_BUNDLED_PNPM_VERSION,
      }),
    ).toEqual({
      schemaVersion: 1,
      version: "1.2.3",
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: DESKTOP_BUNDLED_NODE_VERSION,
      pnpmVersion: DESKTOP_BUNDLED_PNPM_VERSION,
    });
    expect(DESKTOP_UPDATE_UNIT_PARTS).toEqual(["shell", "runtime", "seed"]);
    expect(resolveDesktopUpdateMvpMode()).toBe(DESKTOP_UPDATE_MVP_MODE);
    expect(DESKTOP_UPDATE_MVP_MODE).toBe("full-package");
    expect(DESKTOP_UPDATE_PHASE2_DEFERRED).toContain(
      "blockmap-differential-reuse",
    );
    expect(DESKTOP_UPDATE_PHASE2_DEFERRED).toContain(
      "artifact-upload-pipeline",
    );
    expect(isDesktopUpdatePhase2Deferred("blockmap-differential-reuse")).toBe(
      true,
    );
    expect(isDesktopUpdatePhase2Deferred("full-package")).toBe(false);
  });

  it("rejects split-track update units", () => {
    const release = createDesktopRelease({ version: "1.2.3" });
    expect(() =>
      assertDesktopUpdateUnit({
        release,
        shellVersion: "1.2.3",
        seedVersion: "9.9.9",
        runtimeNodeVersion: release.nodeVersion,
        runtimePnpmVersion: release.pnpmVersion,
      }),
    ).toThrow(/seed/u);
    expect(() =>
      assertDesktopUpdateUnit({
        release,
        shellVersion: "0.0.1",
        seedVersion: "1.2.3",
        runtimeNodeVersion: release.nodeVersion,
        runtimePnpmVersion: release.pnpmVersion,
      }),
    ).toThrow(/shell/u);
  });
});

describe("DesktopUpdateCoordinator", () => {
  it("installs one Desktop release and restarts after download", async () => {
    const states: DesktopUpdateState[] = [];
    const downloadUpdate = vi.fn(async () => []);
    const quitAndInstall = vi.fn();
    const beforeRestart = vi.fn(async () => undefined);
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: "1.1.0" },
      })),
      downloadUpdate,
      quitAndInstall,
    } satisfies DesktopAppUpdater;

    const coordinator = new DesktopUpdateCoordinator({
      publish: (state) => {
        states.push(state);
        return state;
      },
      beforeRestart,
      updater,
      enabled: () => true,
      resolveUpdateUnit: (version) => createDesktopRelease({ version }),
    });

    await expect(coordinator.check()).resolves.toEqual({
      phase: "available",
      version: "1.1.0",
    });
    await expect(coordinator.install()).resolves.toEqual({
      phase: "ready",
      version: "1.1.0",
    });
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(beforeRestart).toHaveBeenCalledOnce();
    expect(quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(states.map((state) => state.phase)).toEqual([
      "checking",
      "available",
      "installing",
      "ready",
    ]);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("queues install behind an in-flight check", async () => {
    let resolveCheck!: (value: {
      isUpdateAvailable: true;
      updateInfo: { version: string };
    }) => void;
    const checkPromise = new Promise<{
      isUpdateAvailable: true;
      updateInfo: { version: string };
    }>((resolve) => {
      resolveCheck = resolve;
    });
    const updater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn(async () => checkPromise),
      downloadUpdate: vi.fn(async () => []),
      quitAndInstall: vi.fn(),
    } satisfies DesktopAppUpdater;

    const coordinator = new DesktopUpdateCoordinator({
      publish: (state) => state,
      updater,
      enabled: () => true,
    });

    const check = coordinator.check();
    const install = coordinator.install();
    resolveCheck({
      isUpdateAvailable: true,
      updateInfo: { version: "2.0.0" },
    });
    await expect(check).resolves.toEqual({
      phase: "available",
      version: "2.0.0",
    });
    await expect(install).resolves.toEqual({
      phase: "ready",
      version: "2.0.0",
    });
  });

  it("stays idle when updater is disabled (unpackaged / no feed)", async () => {
    const updater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    } satisfies DesktopAppUpdater;
    const coordinator = new DesktopUpdateCoordinator({
      publish: (state) => state,
      updater,
      enabled: () => false,
    });
    await expect(coordinator.check()).resolves.toEqual({ phase: "idle" });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
