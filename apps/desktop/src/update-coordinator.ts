/**
 * Desktop update coordinator (ADR-0008).
 * Wraps an electron-updater-shaped port; update unit = shell + runtime + seed (same release).
 * Pattern from dsh: manual download/install, channel=nightly, no auto-download.
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
  /** electron-updater `download-progress`; omit in tests that skip percent. */
  onDownloadProgress?(listener: (percent: number) => void): () => void;
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
  /** Installed application version (Electron `app.getVersion()`). */
  readonly currentVersion?: () => string;
  /**
   * Optional gate: reject install unless shell/runtime/seed match one release.
   * Skeleton callers may omit until packaged resources exist.
   */
  readonly resolveUpdateUnit?: (availableVersion: string) => DesktopRelease;
}

/** Compare dotted versions; true when candidate is strictly newer than current. */
export function desktopVersionIsNewer(
  candidate: string,
  current: string,
): boolean {
  const parse = (value: string): number[] => {
    const core = value.trim().replace(/^v/iu, "").split(/[-+]/u)[0] ?? "";
    return core.split(".").map((part) => {
      const n = Number(part);
      return Number.isFinite(n) ? n : 0;
    });
  };
  const left = parse(candidate);
  const right = parse(current);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/** Checks, downloads, and installs one complete Desktop release. */
export class DesktopUpdateCoordinator {
  private availableVersion: string | undefined;
  private current: DesktopUpdateState = { phase: "idle" };
  private checkOperation: Promise<DesktopUpdateState> | undefined;
  private installOperation: Promise<DesktopUpdateState> | undefined;
  private downloadOperation: Promise<void> | undefined;
  private readonly publishState: (
    state: DesktopUpdateState,
  ) => DesktopUpdateState;
  private readonly beforeRestart: () => Promise<void>;
  private readonly updater: DesktopAppUpdater;
  private readonly enabled: () => boolean;
  private readonly currentVersion: () => string;
  private readonly resolveUpdateUnit:
    | ((availableVersion: string) => DesktopRelease)
    | undefined;
  private lastPercent = -1;

  constructor(options: DesktopUpdateCoordinatorOptions) {
    this.publishState = options.publish;
    this.beforeRestart = options.beforeRestart ?? (async () => undefined);
    this.updater = options.updater;
    this.enabled = options.enabled ?? (() => false);
    this.currentVersion = options.currentVersion ?? (() => "0.0.0");
    this.resolveUpdateUnit = options.resolveUpdateUnit;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.onDownloadProgress?.((percent) => {
      const rounded = Math.round(Math.min(100, Math.max(0, percent)));
      if (rounded === this.lastPercent) return;
      this.lastPercent = rounded;
      if (this.current.phase !== "installing" && this.current.phase !== "available") {
        return;
      }
      this.publish({
        phase: this.current.phase,
        ...(this.availableVersion !== undefined
          ? { version: this.availableVersion }
          : this.current.version !== undefined
            ? { version: this.current.version }
            : {}),
        percent: rounded,
      });
    });
  }

  /** Latest observable state for schedule / UI. */
  get state(): DesktopUpdateState {
    return this.current;
  }

  private publish(state: DesktopUpdateState): DesktopUpdateState {
    this.current = state;
    return this.publishState(state);
  }

  /**
   * Check the configured Desktop release stream and retain an available version.
   * @param _manual - Reserved for UI visibility (dsh parity); check logic is identical.
   */
  async check(_manual = false): Promise<DesktopUpdateState> {
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
      if (this.availableVersion === undefined) {
        await this.checkOperation;
      }
      return this.doInstall();
    })().finally(() => {
      this.installOperation = undefined;
    });
    return this.installOperation;
  }

  private startDownload(): Promise<void> {
    if (this.downloadOperation !== undefined) return this.downloadOperation;
    this.downloadOperation = this.updater.downloadUpdate().then(() => undefined);
    return this.downloadOperation;
  }

  private async doCheck(): Promise<DesktopUpdateState> {
    this.publish({ phase: "checking" });
    try {
      if (!this.enabled()) {
        this.availableVersion = undefined;
        return this.publish({ phase: "idle" });
      }
      const result = await this.updater.checkForUpdates();
      if (result === null) {
        this.availableVersion = undefined;
        return this.publish({ phase: "idle" });
      }
      const version = result.updateInfo?.version?.trim();
      if (version === undefined || version.length === 0) {
        this.availableVersion = undefined;
        return this.publish({ phase: "idle" });
      }
      const newer =
        result.isUpdateAvailable === true
          ? true
          : result.isUpdateAvailable === false
            ? false
            : desktopVersionIsNewer(version, this.currentVersion());
      this.availableVersion = newer ? version : undefined;
      if (this.availableVersion === undefined) {
        this.downloadOperation = undefined;
        return this.publish({ phase: "idle" });
      }
      const available = this.publish({
        phase: "available",
        version: this.availableVersion,
        ...(this.lastPercent > 0 ? { percent: this.lastPercent } : {}),
      });
      /* Prefetch the package; only flip to ready when the bytes are fully here.
       * Install stays disabled until ready so the UI cannot quitAndInstall mid-download. */
      void this.startDownload()
        .then(() => {
          if (this.installOperation !== undefined) return;
          if (this.availableVersion === undefined) return;
          if (
            this.current.phase !== "available" &&
            this.current.phase !== "ready"
          ) {
            return;
          }
          this.lastPercent = 100;
          this.publish({
            phase: "ready",
            version: this.availableVersion,
            percent: 100,
          });
        })
        .catch((error: unknown) => {
          this.downloadOperation = undefined;
          if (this.installOperation !== undefined) return;
          this.publish({
            phase: "error",
            ...(this.availableVersion !== undefined
              ? { version: this.availableVersion }
              : {}),
            message: error instanceof Error ? error.message : String(error),
          });
        });
      return available;
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
    this.publish({
      phase: "installing",
      version,
      percent: Math.max(0, this.lastPercent),
    });
    try {
      await this.startDownload();
      this.lastPercent = 100;
      /* Stay on `installing` through quit — republishing `ready` re-enables the
       * Install button (first click flashes; second click looks like it "works"). */
      const installing = this.publish({
        phase: "installing",
        version,
        percent: 100,
      });
      await this.beforeRestart();
      this.updater.quitAndInstall(false, true);
      this.downloadOperation = undefined;
      return installing;
    } catch (error) {
      return this.publish({
        phase: "error",
        version,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
