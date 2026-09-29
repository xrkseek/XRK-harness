/**
 * Main-renderer preload: typed `window.xrkDesktop` only (ADR-0008).
 * Plugin list/add/remove/update is designed but not exposed until install-ready.
 *
 * Note: the sandboxed runtime load is `dist/preload-app.cjs` from
 * `scripts/emit-preload.mjs` — keep that generator in sync with this file.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createXrkDesktopBridgeApi } from "./bridge.js";
import { DESKTOP_IPC, type XrkDesktopApi } from "./ipc.js";

const bridge = createXrkDesktopBridgeApi({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel, listener) => {
    ipcRenderer.off(channel, listener);
  },
});

const api: XrkDesktopApi = {
  ...bridge,
  files: {
    pathForFile: (file: File): string | undefined => {
      try {
        const path = webUtils.getPathForFile(file);
        return typeof path === "string" && path.trim() !== "" ? path : undefined;
      } catch {
        return undefined;
      }
    },
  },
};

contextBridge.exposeInMainWorld("xrkDesktop", api);

type HostPhase = "starting" | "attaching" | "ready";

let hostPhase: HostPhase = "starting";
const hostPhaseListeners = new Set<(phase: HostPhase) => void>();

function isHostPhase(value: unknown): value is HostPhase {
  return value === "starting" || value === "attaching" || value === "ready";
}

function setHostPhase(phase: HostPhase): void {
  if (hostPhase === phase) return;
  hostPhase = phase;
  for (const listener of hostPhaseListeners) listener(phase);
}

ipcRenderer.on(DESKTOP_IPC.hostPhase, (_event, phase: unknown) => {
  if (isHostPhase(phase)) setHostPhase(phase);
});

void ipcRenderer.invoke(DESKTOP_IPC.hostPhaseGet).then((phase: unknown) => {
  if (isHostPhase(phase)) setHostPhase(phase);
});

/**
 * Await until Desktop Host Fetch is attached (main `markDesktopHostFetchReady`).
 * Connection uses this as `waitUntil` on `xrk-app:` so Face does not hammer
 * retry:backoff before the pipe is live.
 * Rejects when main reports Host bring-up failure.
 */
function whenHostReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (onReady: () => void, onFailed: (_event: unknown, message: unknown) => void): void => {
      ipcRenderer.off(DESKTOP_IPC.hostReady, onReady);
      ipcRenderer.off(DESKTOP_IPC.hostFailed, onFailed);
    };
    void ipcRenderer.invoke(DESKTOP_IPC.hostReadyGet).then((ready) => {
      if (ready === true) {
        setHostPhase("ready");
        resolve();
        return;
      }
      const onReady = (): void => {
        cleanup(onReady, onFailed);
        setHostPhase("ready");
        resolve();
      };
      const onFailed = (_event: unknown, message: unknown): void => {
        cleanup(onReady, onFailed);
        reject(
          new Error(
            typeof message === "string" && message.trim() !== ""
              ? message
              : "Desktop Host failed to start",
          ),
        );
      };
      ipcRenderer.on(DESKTOP_IPC.hostReady, onReady);
      ipcRenderer.on(DESKTOP_IPC.hostFailed, onFailed);
    });
  });
}

function getHostPhase(): HostPhase {
  return hostPhase;
}

function subscribeHostPhase(listener: (phase: HostPhase) => void): () => void {
  hostPhaseListeners.add(listener);
  return () => {
    hostPhaseListeners.delete(listener);
  };
}

// Desktop owns the private Host — client treats this as the privileged surface
// (canOpenPath / pickDirectory UI gates on isLoopback ∧ host.canOpenPath).
// Product UI loads Host loopback HTTP after ready; xrk-app:// is splash/static.
contextBridge.exposeInMainWorld("__XRK_TRANSPORT__", {
  ownsHost: true,
  whenHostReady,
  getHostPhase,
  subscribeHostPhase,
});
