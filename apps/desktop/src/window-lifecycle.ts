/**
 * Main-window lifecycle helpers for the Desktop shell (ADR-0008).
 * Renderer defaults: sandbox + contextIsolation; no nodeIntegration.
 */

export const DESKTOP_WINDOW_DEFAULTS = {
  width: 1280,
  height: 840,
  minWidth: 880,
  minHeight: 600,
  show: false,
} as const;

/** webPreferences locked by ADR-0008 renderer security. */
export const DESKTOP_WEB_PREFERENCES = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
} as const;

export interface DesktopShellWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  once(event: "ready-to-show", listener: () => void): void;
  on(event: "closed", listener: () => void): void;
}

export interface DesktopLifecycleApplication {
  on(event: "activate" | "window-all-closed", listener: () => void): unknown;
  quit(): void;
}

/** Show the window on first ready-to-show if it still exists. */
export function showDesktopWindowWhenReady(window: DesktopShellWindow): void {
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
}

/** Clear the main-window slot when that exact window closes. */
export function bindDesktopMainWindowClosed(
  window: DesktopShellWindow,
  getMain: () => DesktopShellWindow | undefined,
  setMain: (next: DesktopShellWindow | undefined) => void,
): void {
  window.on("closed", () => {
    if (getMain() === window) setMain(undefined);
  });
}

/**
 * Focus the existing primary window, or recreate + load when missing/destroyed.
 * Used by second-instance and macOS activate.
 */
export function focusOrRecreatePrimaryWindow(options: {
  getMain: () => DesktopShellWindow | undefined;
  setMain: (next: DesktopShellWindow | undefined) => void;
  createMainWindow: () => DesktopShellWindow;
  loadPrimary: (window: DesktopShellWindow) => void;
}): void {
  const current = options.getMain();
  if (current === undefined || current.isDestroyed()) {
    const replacement = options.createMainWindow();
    options.setMain(replacement);
    options.loadPrimary(replacement);
    return;
  }
  if (current.isMinimized()) current.restore();
  current.show();
  current.focus();
}

/** Wire activate (recreate when empty) and window-all-closed (quit except macOS). */
export function attachDesktopWindowLifecycle(
  application: DesktopLifecycleApplication,
  options: {
    platform: NodeJS.Platform;
    focusPrimary: () => void;
    getWindowCount: () => number;
  },
): void {
  application.on("activate", () => {
    if (options.getWindowCount() === 0) options.focusPrimary();
  });
  application.on("window-all-closed", () => {
    if (options.platform !== "darwin") application.quit();
  });
}
