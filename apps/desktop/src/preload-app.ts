/**
 * Main-renderer preload: typed `window.xrkDesktop` only (ADR-0008).
 * Plugin list/add/remove/update is designed but not exposed until install-ready.
 *
 * Note: the sandboxed runtime load is `dist/preload-app.cjs` from
 * `scripts/emit-preload.mjs` — keep that generator in sync with this file.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createXrkDesktopBridgeApi } from "./bridge.js";
import { waitForHostReady } from "./host-ready-wait.js";
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
const hostReadyListeners = new Set<() => void>();

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

ipcRenderer.on(DESKTOP_IPC.hostReady, () => {
  setHostPhase("ready");
  for (const listener of hostReadyListeners) listener();
});

void ipcRenderer.invoke(DESKTOP_IPC.hostPhaseGet).then((phase: unknown) => {
  if (isHostPhase(phase)) setHostPhase(phase);
});

/**
 * Await until Desktop Host Fetch is attached (main `markDesktopHostFetchReady`).
 * Connection uses this as `waitUntil` on `xrk-app:` so Face does not hammer
 * retry:backoff before the pipe is live.
 * Rejects when main reports Host bring-up failure (event or sticky).
 */
function whenHostReady(): Promise<void> {
  return waitForHostReady({
    getReady: async () => {
      const ready = await ipcRenderer.invoke(DESKTOP_IPC.hostReadyGet);
      if (ready === true) setHostPhase("ready");
      return ready === true;
    },
    getFailed: async () => {
      const failed = await ipcRenderer.invoke(DESKTOP_IPC.hostFailedGet);
      return typeof failed === "string" ? failed : null;
    },
    onReady: (listener) => {
      const handle = (): void => {
        listener();
      };
      ipcRenderer.on(DESKTOP_IPC.hostReady, handle);
      return () => {
        ipcRenderer.off(DESKTOP_IPC.hostReady, handle);
      };
    },
    onFailed: (listener) => {
      const handle = (_event: unknown, message: unknown): void => {
        listener(
          typeof message === "string" && message.trim() !== ""
            ? message
            : "Desktop Host failed to start",
        );
      };
      ipcRenderer.on(DESKTOP_IPC.hostFailed, handle);
      return () => {
        ipcRenderer.off(DESKTOP_IPC.hostFailed, handle);
      };
    },
  }).then(() => {
    setHostPhase("ready");
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

/** Pulse when Host Fetch becomes ready (kick Face out of backoff). */
function subscribeHostReady(listener: () => void): () => void {
  hostReadyListeners.add(listener);
  return () => {
    hostReadyListeners.delete(listener);
  };
}

/** After restart budget exhaustion: ask main to schedule Host bring-up again. */
function requestHostRebring(): Promise<void> {
  return ipcRenderer.invoke(DESKTOP_IPC.hostRebring).then(() => undefined);
}

// Desktop owns the private Host — client treats this as the privileged surface
// (canOpenPath / pickDirectory UI gates on isLoopback ∧ host.canOpenPath).
// Product UI stays on xrk-app://; Face is proxied to the loopback Host after ready.
contextBridge.exposeInMainWorld("__XRK_TRANSPORT__", {
  ownsHost: true,
  whenHostReady,
  getHostPhase,
  subscribeHostPhase,
  subscribeHostReady,
  requestHostRebring,
});
