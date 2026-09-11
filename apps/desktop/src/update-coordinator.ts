/**
 * Desktop update coordinator skeleton (ADR-0008).
 * Wraps an electron-updater-shaped port; update unit = shell + runtime + seed (same release).
 * Does not vendor Cordis; full signing / channel publish stay deferred in status.
 */

import type { DesktopUpdateState } from "./ipc.js";
import {
  assertDesktopUpdateUnit,
  type DesktopRelease,
} from "./release.js";

/**
 * Minimal AppUpdater surface used by the coordinator.
 * Production Main wires `electron-updater`’s `autoUpdater`; tests inject fakes.
 */
export interface DesktopAppUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<{
    isUpdateAvailable?: boolean;
    updateInfo?: { version?: string };
  } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface DesktopUpdateCoordinatorOptions {
  /** Push state to every desktop window / preload subscribers. */
  readonly publish: (state: DesktopUpdateState) => DesktopUpdateState;
  /** Stop Host / workers before quitAndInstall. */
  readonly beforeRestart?: () => Promise<void>;
  /** electron-updater (or test double). */
  readonly updater: DesktopAppUpdater;
  /**
   * Whether this process may talk to the update feed
   * (typically packaged + `app-update.yml` present).
   */
  readonly enabled?: () => boolean;
  /**
   * Optional gate: reject install unless shell/runtime/seed match one release.
   * Skeleton callers may omit until packaged resources exist.
   */
  readonly resolveUpdateUnit?: (availableVersion: string) => DesktopRelease;
}

/** Checks, downloads, and installs one complete Desktop release. */
export class DesktopUpdateCoordinator {
  private availableVersion: string | undefined;
  private checkOperation: Promise<DesktopUpdateState> | undefined;
  private installOperation: Promise<DesktopUpdateState> | undefined;
  private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState;
  private readonly beforeRestart: () => Promise<void>;
  private readonly updater: DesktopAppUpdater;
  private readonly enabled: () => boolean;
  private readonly resolveUpdateUnit:
    | ((availableVersion: string) => DesktopRelease)
    | undefined;

  constructor(options: DesktopUpdateCoordinatorOptions) {
    this.publish = options.publish;
    this.beforeRestart = options.beforeRestart ?? (async () => undefined);
    this.updater = options.updater;
    this.enabled = options.enabled ?? (() => false);
    this.resolveUpdateUnit = options.resolveUpdateUnit;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
  }

  /** Check the configured Desktop release stream and retain an available version. */
  async check(): Promise<DesktopUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation;
    if (this.checkOperation !== undefined) return this.checkOperation;
    this.checkOperation = this.doCheck().finally(() => {
      this.checkOperation = undefined;
    });
    return this.checkOperation;
  }

  /** Wait for an in-flight check, then download and install its retained release. */
  async install(): Promise<DesktopUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation;
    this.installOperation = (async () => {
      await this.checkOperation;
      return this.doInstall();
    })().finally(() => {
      this.installOperation = undefined;
    });
    return this.installOperation;
  }

  private async doCheck(): Promise<DesktopUpdateState> {
    this.publish({ phase: "checking" });
    try {
      if (!this.enabled()) {
        this.availableVersion = undefined;
        return this.publish({ phase: "idle" });
      }
      const result = await this.updater.checkForUpdates();
      const version =
        result?.isUpdateAvailable === true
          ? result.updateInfo?.version
          : undefined;
      this.availableVersion =
        typeof version === "string" && version.length > 0 ? version : undefined;
      return this.availableVersion === undefined
        ? this.publish({ phase: "idle" })
        : this.publish({ phase: "available", version: this.availableVersion });
    } catch (error) {
      this.availableVersion = undefined;
      return this.publish({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async doInstall(): Promise<DesktopUpdateState> {
    const version = this.availableVersion;
    if (version === undefined) {
      throw new Error("xrk desktop update: no verified update is available");
    }
    if (this.resolveUpdateUnit !== undefined) {
      const release = this.resolveUpdateUnit(version);
      // Update unit = shell + runtime + seed at the same Desktop version.
      assertDesktopUpdateUnit({
        release,
        shellVersion: release.version,
        seedVersion: release.version,
        runtimeNodeVersion: release.nodeVersion,
        runtimePnpmVersion: release.pnpmVersion,
      });
      if (release.version !== version) {
        throw new Error(
          `xrk desktop update: feed version ${version} does not match release unit ${release.version}`,
        );
      }
    }
    this.publish({ phase: "installing", version });
    try {
      await this.updater.downloadUpdate();
      this.availableVersion = undefined;
      const ready = this.publish({ phase: "ready", version });
      await this.beforeRestart();
      this.updater.quitAndInstall(false, true);
      return ready;
    } catch (error) {
      return this.publish({
        phase: "error",
        version,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
