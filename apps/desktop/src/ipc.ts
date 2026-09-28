/** Typed preload operations exposed only by the Electron shell (ADR-0008). */

import type { DesktopLocale } from "./locale.js";

/** IPC channel names private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: "xrk-desktop:locale-get",
  updatesCheck: "xrk-desktop:updates-check",
  updatesInstall: "xrk-desktop:updates-install",
  updatesState: "xrk-desktop:updates-state",
  windowMinimize: "xrk-desktop:window-minimize",
  windowMaximizeToggle: "xrk-desktop:window-maximize-toggle",
  windowClose: "xrk-desktop:window-close",
  windowIsMaximized: "xrk-desktop:window-is-maximized",
  windowMaximized: "xrk-desktop:window-maximized",
  windowReload: "xrk-desktop:window-reload",
} as const;

/** Renderer bridge marker (≠ Host framed-pipe protocol version). */
export const DESKTOP_BRIDGE_PROTOCOL_VERSION = 1 as const;

/** Desktop release update state for desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase:
    | "idle"
    | "checking"
    | "available"
    | "installing"
    | "ready"
    | "error";
  readonly version?: string;
  readonly message?: string;
}

/**
 * Narrow bridge through contextIsolation.
 * Plugin install surface (`plugin-install-surface.ts`) is a deferred Desktop
 * *profile* pnpm design — product Settings install uses Face
 * `pluginInventory/install` → `xrkh plugin add` instead.
 * preload wiring stays phase 2 until `isDesktopPluginInstallReady()`.
 */
/** Frameless shell window controls (renderer-drawn min/max/close + reload). */
export interface XrkDesktopWindowApi {
  minimize(): Promise<void>;
  /** Toggle maximize / restore. */
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  subscribeMaximized(listener: (maximized: boolean) => void): () => void;
  /** Reload the product renderer (client-half remount; Host stays up). */
  reload(): Promise<void>;
}

export interface XrkDesktopApi {
  readonly protocolVersion: typeof DESKTOP_BRIDGE_PROTOCOL_VERSION;
  locale(): Promise<DesktopLocale>;
  readonly updates: {
    check(): Promise<DesktopUpdateState>;
    install(): Promise<void>;
    subscribe(listener: (state: DesktopUpdateState) => void): () => void;
  };
  readonly window: XrkDesktopWindowApi;
}
