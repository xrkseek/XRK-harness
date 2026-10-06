/**
 * Main-process IPC handlers for the narrow preload bridge
 * (locale + updates + frameless window chrome).
 */

import type { DesktopLocale } from "./locale.js";
import { resolveDesktopLocale } from "./locale.js";
import { DESKTOP_IPC, type DesktopUpdateState } from "./ipc.js";

export interface DesktopIpcMain {
  handle(
    channel: string,
    listener: (
      event: unknown,
      ...args: unknown[]
    ) => unknown | Promise<unknown>,
  ): void;
}

/** Minimal BrowserWindow surface for frameless chrome IPC. */
export interface DesktopIpcWindow {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  isMaximized(): boolean;
  isDestroyed(): boolean;
  webContents: { reload(): void; send(channel: string, ...args: unknown[]): void };
  on(event: "maximize" | "unmaximize", listener: () => void): unknown;
}

export interface RegisterDesktopIpcOptions {
  /** Electron `app.getLocale()` (or test stub). */
  getLocale: () => string;
  /** Electron `app.getVersion()` (or test stub). */
  getAppVersion?: () => string;
  /** Latest coordinator state without hitting the feed. */
  getUpdateState?: () => DesktopUpdateState;
  /**
   * Update check / install. Prefer wiring {@link DesktopUpdateCoordinator}
   * (electron-updater port). Default: idle / not configured.
   */
  checkUpdates?: () => Promise<DesktopUpdateState>;
  installUpdate?: () => Promise<void>;
  /** Resolve the BrowserWindow that owns an IPC event (Electron `event`). */
  windowFromEvent?: (event: unknown) => DesktopIpcWindow | undefined;
  /**
   * Whether Desktop Host Fetch is already attached (preload `whenHostReady`).
   * Default: always false until main wires {@link markDesktopHostFetchReady}.
   */
  isHostReady?: () => boolean;
  /** Current Host bring-up phase for splash hints. */
  getHostPhase?: () => "starting" | "attaching" | "ready";
}

const idleUpdate: DesktopUpdateState = { phase: "idle" };

const maximizedWired = new WeakSet<DesktopIpcWindow>();

function wireMaximizedPush(win: DesktopIpcWindow): void {
  if (maximizedWired.has(win)) return;
  maximizedWired.add(win);
  const push = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(DESKTOP_IPC.windowMaximized, win.isMaximized());
  };
  win.on("maximize", push);
  win.on("unmaximize", push);
}

/** Register locale + update + window chrome IPC handlers on `ipcMain`. */
export function registerDesktopIpcHandlers(
  ipcMain: DesktopIpcMain,
  options: RegisterDesktopIpcOptions,
): void {
  ipcMain.handle(DESKTOP_IPC.localeGet, (): DesktopLocale => {
    return resolveDesktopLocale(options.getLocale());
  });
  ipcMain.handle(DESKTOP_IPC.appVersion, (): string => {
    return options.getAppVersion?.() ?? "";
  });
  ipcMain.handle(DESKTOP_IPC.updatesSnapshot, (): DesktopUpdateState => {
    return options.getUpdateState?.() ?? idleUpdate;
  });
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (): Promise<DesktopUpdateState> => {
    if (options.checkUpdates) return options.checkUpdates();
    return idleUpdate;
  });
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (): Promise<void> => {
    if (options.installUpdate) {
      await options.installUpdate();
      return;
    }
    throw new Error("xrk desktop: update install is not configured");
  });

  const winOf = (event: unknown): DesktopIpcWindow | undefined =>
    options.windowFromEvent?.(event);

  ipcMain.handle(DESKTOP_IPC.windowMinimize, (event) => {
    winOf(event)?.minimize();
  });
  ipcMain.handle(DESKTOP_IPC.windowMaximizeToggle, (event) => {
    const win = winOf(event);
    if (!win) return;
    wireMaximizedPush(win);
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(DESKTOP_IPC.windowClose, (event) => {
    winOf(event)?.close();
  });
  ipcMain.handle(DESKTOP_IPC.windowIsMaximized, (event): boolean => {
    const win = winOf(event);
    if (!win) return false;
    wireMaximizedPush(win);
    return win.isMaximized();
  });
  ipcMain.handle(DESKTOP_IPC.windowReload, (event) => {
    winOf(event)?.webContents.reload();
  });

  ipcMain.handle(DESKTOP_IPC.hostReadyGet, (): boolean => {
    return options.isHostReady?.() === true;
  });
  ipcMain.handle(DESKTOP_IPC.hostPhaseGet, (): "starting" | "attaching" | "ready" => {
    return options.getHostPhase?.() ?? "starting";
  });
}
