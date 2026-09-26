/**
 * Main-process helpers: publish update state · dialogs · application menu (ADR-0008).
 */

import {
  formatDesktopMessage,
  resolveDesktopLocale,
  type DesktopLocale,
} from "./locale.js";
import { DESKTOP_IPC, type DesktopUpdateState } from "./ipc.js";
import type { DesktopUpdateCoordinator } from "./update-coordinator.js";

/** Minimal BrowserWindow surface used to push update state. */
export interface DesktopUpdateBroadcastWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

export interface DesktopUpdateDialogBox {
  showMessageBox(
    window: unknown | undefined,
    options: {
      type?: string;
      title?: string;
      message: string;
      detail?: string;
      buttons: string[];
      defaultId?: number;
      cancelId?: number;
    },
  ): Promise<{ response: number }>;
}

export interface DesktopUpdateMenuApi {
  setApplicationMenu(menu: unknown): void;
  buildFromTemplate(template: unknown[]): unknown;
}

/** Broadcast update state to every live Desktop window (preload subscribe). */
export function publishDesktopUpdateState(
  windows: readonly DesktopUpdateBroadcastWindow[],
  state: DesktopUpdateState,
): DesktopUpdateState {
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    window.webContents.send(DESKTOP_IPC.updatesState, state);
  }
  return state;
}

/**
 * Present check / available / error dialogs for a manual check.
 * Returns true when the user chose Install and Restart.
 */
export async function presentDesktopUpdateCheckDialog(options: {
  readonly state: DesktopUpdateState;
  readonly locale: DesktopLocale;
  readonly dialog: DesktopUpdateDialogBox;
  readonly parentWindow?: unknown;
}): Promise<"install" | "dismissed"> {
  const { state, locale, dialog, parentWindow } = options;
  const m = locale.messages;
  if (state.phase === "error") {
    await dialog.showMessageBox(parentWindow, {
      type: "error",
      title: m.updateCheckFailedTitle,
      message: m.updateCheckFailedTitle,
      detail: state.message ?? m.unknownError,
      buttons: ["OK"],
      defaultId: 0,
    });
    return "dismissed";
  }
  if (state.phase === "idle" || state.version === undefined) {
    await dialog.showMessageBox(parentWindow, {
      type: "info",
      title: m.updateCheckTitle,
      message: m.updateCurrent,
      buttons: ["OK"],
      defaultId: 0,
    });
    return "dismissed";
  }
  if (state.phase === "available" || state.phase === "ready") {
    const result = await dialog.showMessageBox(parentWindow, {
      type: "info",
      title: m.updateTitle,
      message: m.updateAvailable,
      detail: formatDesktopMessage(m.updateDetail, {
        version: state.version,
      }),
      buttons: [m.installAndRestart, m.later],
      defaultId: 0,
      cancelId: 1,
    });
    return result.response === 0 ? "install" : "dismissed";
  }
  return "dismissed";
}

/** Build and install the Application menu with Check for Updates. */
export function installDesktopApplicationMenu(options: {
  readonly menu: DesktopUpdateMenuApi;
  readonly getLocale: () => string;
  readonly onCheckUpdates: () => void;
  readonly platform?: NodeJS.Platform;
}): void {
  const locale = resolveDesktopLocale(options.getLocale());
  const checkItem = {
    label: locale.messages.checkUpdatesMenu,
    click: () => {
      options.onCheckUpdates();
    },
  };
  const appMenu = {
    label: locale.messages.application,
    submenu: [checkItem],
  };
  const template =
    options.platform === "darwin"
      ? [appMenu]
      : [
          {
            label: locale.messages.application,
            submenu: [checkItem],
          },
        ];
  options.menu.setApplicationMenu(options.menu.buildFromTemplate(template));
}

/**
 * Manual check path: schedule/coordinator check → dialog → optional install.
 */
export async function runDesktopManualUpdateCheck(options: {
  readonly coordinator: DesktopUpdateCoordinator;
  readonly check: () => Promise<DesktopUpdateState>;
  readonly locale: DesktopLocale;
  readonly dialog: DesktopUpdateDialogBox;
  readonly parentWindow?: unknown;
}): Promise<DesktopUpdateState> {
  const state = await options.check();
  const choice = await presentDesktopUpdateCheckDialog({
    state,
    locale: options.locale,
    dialog: options.dialog,
    parentWindow: options.parentWindow,
  });
  if (choice === "install" && state.version !== undefined) {
    return options.coordinator.install();
  }
  return state;
}
