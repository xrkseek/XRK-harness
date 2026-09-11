/**
 * Build the narrow `xrkDesktop` bridge without importing Electron (testable).
 * No raw ipc / fs / shell — only typed locale + update channels.
 */

import {
  DESKTOP_BRIDGE_PROTOCOL_VERSION,
  DESKTOP_IPC,
  type DesktopUpdateState,
  type XrkDesktopApi,
} from "./ipc.js";
import type { DesktopLocale } from "./locale.js";

export interface DesktopBridgeIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
  off(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
}

/** Create the contextBridge payload for the main product renderer. */
export function createXrkDesktopBridgeApi(
  ipc: DesktopBridgeIpc,
): XrkDesktopApi {
  return {
    protocolVersion: DESKTOP_BRIDGE_PROTOCOL_VERSION,
    locale: () => ipc.invoke(DESKTOP_IPC.localeGet) as Promise<DesktopLocale>,
    updates: {
      check: () =>
        ipc.invoke(DESKTOP_IPC.updatesCheck) as Promise<DesktopUpdateState>,
      install: async () => {
        await ipc.invoke(DESKTOP_IPC.updatesInstall);
      },
      subscribe: (listener) => {
        const handle = (_event: unknown, state: unknown): void => {
          listener(state as DesktopUpdateState);
        };
        ipc.on(DESKTOP_IPC.updatesState, handle);
        return () => {
          ipc.off(DESKTOP_IPC.updatesState, handle);
        };
      },
    },
  };
}
