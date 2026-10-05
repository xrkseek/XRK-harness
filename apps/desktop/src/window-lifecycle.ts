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
  // Light splash floor (override with dark via boot-appearance when preference
  // resolves to dark — Chromium default white during Host-ready loadURL is harsher).
  backgroundColor: "#f4f4f5",
  // Product chrome draws drag + (on Windows) min/max/close in the renderer.
  // Darwin uses hiddenInset traffic lights instead of custom caption buttons.
  frame: false,
  // Keep edge resize hit-testing on frameless Windows (thickFrame default
  // is true; spell it so a future default flip cannot wedge the shell).
  resizable: true,
  thickFrame: true,
} as const;

/** Extra BrowserWindow options for the host platform. */
export function desktopWindowPlatformOptions(
  platform: NodeJS.Platform,
): {
  readonly titleBarStyle?: "hiddenInset";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
} {
  if (platform !== "darwin") return {};
  return {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 12 },
  };
}

/** webPreferences locked by ADR-0008 renderer security. */
export const DESKTOP_WEB_PREFERENCES = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  // Desktop is not a background browser tab: a minimized / occluded window must
  // keep its animation clock. Chromium's default throttling marks the page hidden
  // there, which suspends requestAnimationFrame and freezes frame-batched UI
  // (streaming replies stop painting until a reload). Desktop also streams agent
  // turns while the user is elsewhere, so the retained visibility state is the
  // point — not a power tradeoff taken lightly, but a correctness one.
  backgroundThrottling: false,
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
