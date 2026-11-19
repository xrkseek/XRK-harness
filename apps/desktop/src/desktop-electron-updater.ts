/**
 * Wire electron-updater into the DesktopAppUpdater port (ADR-0008).
 * Product feed: GitHub Releases + phone-aligned prefix-mirror ladder.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { DesktopAppUpdater } from "./update-coordinator.js";
import {
  DESKTOP_UPDATE_PREFERRED_MIRROR_KEY,
  orderedDesktopUpdateFeedSteps,
  type DesktopUpdateFeedStep,
} from "./desktop-update-mirrors.js";

export interface DesktopElectronUpdaterOptions {
  /** electron-updater channel (matches packaged app-update.yml). */
  readonly channel?: "nightly";
  readonly allowPrerelease?: boolean;
  readonly allowDowngrade?: boolean;
  /** Windows: unsigned test feeds must skip Authenticode publisher checks. */
  readonly verifyUpdateCodeSignature?: boolean;
  /** Override mirror preference store (tests). */
  readonly preferredMirrorPath?: string;
  /** Override timezone offset minutes (tests); default = local. */
  readonly timezoneOffsetMinutes?: number;
  /** HTTP(S) CONNECT proxy for updater netSession (e.g. Clash). */
  readonly proxyUrl?: string;
}

function defaultPreferredMirrorPath(): string {
  const home = process.env.XRK_HOME?.trim() || process.env.USERPROFILE || process.env.HOME;
  if (!home) return path.join(process.cwd(), ".xrk", "desktop-update-mirror.json");
  return path.join(home, ".xrk", "desktop-update-mirror.json");
}

export function readPreferredDesktopUpdateMirror(
  filePath: string = defaultPreferredMirrorPath(),
): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      [DESKTOP_UPDATE_PREFERRED_MIRROR_KEY]?: string;
      id?: string;
    };
    const id =
      raw[DESKTOP_UPDATE_PREFERRED_MIRROR_KEY]?.trim() || raw.id?.trim();
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function writePreferredDesktopUpdateMirror(
  id: string,
  filePath: string = defaultPreferredMirrorPath(),
): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify({ [DESKTOP_UPDATE_PREFERRED_MIRROR_KEY]: id, id }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* preference is best-effort */
  }
}

function applyFeedStep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-updater
  updater: any,
  step: DesktopUpdateFeedStep,
): void {
  if (typeof updater.setFeedURL !== "function") return;
  if (step.kind === "github") {
    updater.setFeedURL({
      provider: "github",
      owner: step.owner,
      repo: step.repo,
      channel: step.channel,
    });
    return;
  }
  updater.setFeedURL({
    provider: "generic",
    url: step.url,
    channel: step.channel,
  });
}

function applyUpdaterProxy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-updater
  updater: any,
  proxyUrl: string | undefined,
): void {
  const raw = proxyUrl?.trim();
  if (!raw || raw === "direct" || raw === "none" || raw === "off") return;
  const session = updater.netSession;
  if (!session || typeof session.setProxy !== "function") return;
  void session.setProxy({ proxyRules: raw });
}

function resolveProxyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HTTPS_PROXY?.trim() ||
    env.HTTP_PROXY?.trim() ||
    env.ALL_PROXY?.trim() ||
    undefined
  );
}

/**
 * Configure process-owned `autoUpdater` for full-package Desktop updates.
 * `checkForUpdates` walks the phone-style mirror ladder until one feed answers.
 */
export function configureDesktopElectronUpdater(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-updater AppUpdater surface
  updater: any,
  options: DesktopElectronUpdaterOptions = {},
): DesktopAppUpdater {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.channel = options.channel ?? "nightly";
  updater.allowPrerelease = options.allowPrerelease ?? true;
  updater.allowDowngrade = options.allowDowngrade ?? false;
  if (options.verifyUpdateCodeSignature === false) {
    updater.verifyUpdateCodeSignature = false;
  }

  const preferredPath =
    options.preferredMirrorPath ?? defaultPreferredMirrorPath();
  applyUpdaterProxy(
    updater,
    options.proxyUrl ?? resolveProxyFromEnv(),
  );

  return {
    get autoDownload() {
      return updater.autoDownload as boolean;
    },
    set autoDownload(value: boolean) {
      updater.autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return updater.autoInstallOnAppQuit as boolean;
    },
    set autoInstallOnAppQuit(value: boolean) {
      updater.autoInstallOnAppQuit = value;
    },
    checkForUpdates: async () => {
      const preferred = readPreferredDesktopUpdateMirror(preferredPath);
      const steps = orderedDesktopUpdateFeedSteps({
        preferredId: preferred,
        ...(options.timezoneOffsetMinutes !== undefined
          ? { timezoneOffsetMinutes: options.timezoneOffsetMinutes }
          : {}),
      });
      let lastError: unknown;
      for (const step of steps) {
        try {
          applyFeedStep(updater, step);
          const result = await updater.checkForUpdates();
          if (result === null || result === undefined) {
            lastError = new Error(`empty result from ${step.id}`);
            continue;
          }
          const version = result.updateInfo?.version;
          if (typeof version !== "string" || version.trim().length === 0) {
            lastError = new Error(`no version from ${step.id}`);
            continue;
          }
          writePreferredDesktopUpdateMirror(step.id, preferredPath);
          return {
            updateInfo: { version },
            ...(typeof result.isUpdateAvailable === "boolean"
              ? { isUpdateAvailable: result.isUpdateAvailable }
              : {}),
          };
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError instanceof Error) throw lastError;
      throw new Error(
        `xrk desktop update: all feeds failed (${steps.map((s) => s.id).join(", ")})`,
      );
    },
    downloadUpdate: async () => updater.downloadUpdate(),
    quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => {
      updater.quitAndInstall(isSilent ?? false, isForceRunAfter ?? true);
    },
    onDownloadProgress: (listener: (percent: number) => void) => {
      const handle = (info: { percent?: number }): void => {
        const raw = typeof info?.percent === "number" ? info.percent : 0;
        listener(raw);
      };
      updater.on("download-progress", handle);
      return () => {
        updater.off("download-progress", handle);
      };
    },
  };
}

/**
 * Dynamically import electron-updater and return a configured port.
 * Returns undefined when the optional dependency is missing (dev / CI without Electron).
 */
export async function tryCreateDesktopElectronUpdater(
  options: DesktopElectronUpdaterOptions = {},
): Promise<DesktopAppUpdater | undefined> {
  try {
    const mod = (await import("electron-updater")) as {
      autoUpdater?: unknown;
      default?: { autoUpdater?: unknown };
    };
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (autoUpdater === undefined) return undefined;
    return configureDesktopElectronUpdater(autoUpdater, options);
  } catch {
    return undefined;
  }
}
