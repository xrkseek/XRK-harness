/** Typed preload operations exposed only by the Electron shell (ADR-0008). */

import type { DesktopLocale } from "./locale.js";

/** IPC channel names private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: "xrk-desktop:locale-get",
  updatesCheck: "xrk-desktop:updates-check",
  updatesInstall: "xrk-desktop:updates-install",
  updatesState: "xrk-desktop:updates-state",
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
 * Plugin install surface is designed (`plugin-install-surface.ts`) but
 * preload wiring stays phase 2 until `isDesktopPluginInstallReady()`.
 */
export interface XrkDesktopApi {
  readonly protocolVersion: typeof DESKTOP_BRIDGE_PROTOCOL_VERSION;
  locale(): Promise<DesktopLocale>;
  readonly updates: {
    check(): Promise<DesktopUpdateState>;
    install(): Promise<void>;
    subscribe(listener: (state: DesktopUpdateState) => void): () => void;
  };
}
