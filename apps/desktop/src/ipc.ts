/** Typed preload operations exposed only by the Electron shell (ADR-0008). */

import type { DesktopLocale } from "./locale.js";

/** IPC channel names private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: "xrk-desktop:locale-get",
  appVersion: "xrk-desktop:app-version",
  updatesCheck: "xrk-desktop:updates-check",
  updatesInstall: "xrk-desktop:updates-install",
  updatesSnapshot: "xrk-desktop:updates-snapshot",
  updatesState: "xrk-desktop:updates-state",
  windowMinimize: "xrk-desktop:window-minimize",
  windowMaximizeToggle: "xrk-desktop:window-maximize-toggle",
  windowClose: "xrk-desktop:window-close",
  windowIsMaximized: "xrk-desktop:window-is-maximized",
  windowMaximized: "xrk-desktop:window-maximized",
  windowReload: "xrk-desktop:window-reload",
  /** True once Desktop Host Fetch is wired into `xrk-app://` (Face ready). */
  hostReadyGet: "xrk-desktop:host-ready-get",
  /** Push when Host Fetch attaches (renderer may await before Face connect). */
  hostReady: "xrk-desktop:host-ready",
  /** Push when Host spawn/ready fails (renderer fails splash loud). */
  hostFailed: "xrk-desktop:host-failed",
  /** Sticky Host failure message after `hostFailed` (null when none). */
  hostFailedGet: "xrk-desktop:host-failed-get",
  /** Current Host bring-up phase (`starting` | `attaching` | `ready`). */
  hostPhaseGet: "xrk-desktop:host-phase-get",
  /** Push Host bring-up phase for splash hints. */
  hostPhase: "xrk-desktop:host-phase",
  /** After restart budget exhaustion: clear sticky and schedule bring-up again. */
  hostRebring: "xrk-desktop:host-rebring",
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
  /** Download percent 0–100 while `phase` is `installing`. */
  readonly percent?: number;
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
  /** Host OS for chrome layout (`darwin` → native traffic lights). */
  readonly platform: NodeJS.Platform;
  locale(): Promise<DesktopLocale>;
  /** Packaged Desktop release (`app.getVersion()`). */
  version(): Promise<string>;
  readonly updates: {
    check(): Promise<DesktopUpdateState>;
    snapshot(): Promise<DesktopUpdateState>;
    install(): Promise<void>;
    subscribe(listener: (state: DesktopUpdateState) => void): () => void;
  };
  readonly window: XrkDesktopWindowApi;
  /**
   * Local filesystem helpers for the sandboxed renderer.
   * `pathForFile` uses Electron `webUtils.getPathForFile` (must stay in preload).
   */
  readonly files: {
    /** Absolute OS path for a dropped/picked File, or undefined when unavailable. */
    pathForFile(file: File): string | undefined;
  };
}
