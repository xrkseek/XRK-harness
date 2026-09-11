/**
 * Main-renderer preload: typed `window.xrkDesktop` only (ADR-0008).
 * Plugin list/add/remove/update is designed but not exposed until install-ready.
 */

import { contextBridge, ipcRenderer } from "electron";
import { createXrkDesktopBridgeApi } from "./bridge.js";

const api = createXrkDesktopBridgeApi({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel, listener) => {
    ipcRenderer.off(channel, listener);
  },
});

contextBridge.exposeInMainWorld("xrkDesktop", api);
// Desktop owns the private Host — client treats this as the privileged surface
// (canOpenPath / pickDirectory UI gates on isLoopback ∧ host.canOpenPath).
contextBridge.exposeInMainWorld("__XRK_TRANSPORT__", { ownsHost: true });
