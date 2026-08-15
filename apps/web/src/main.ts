import { FACE_CONSOLE_BOOT, XRK_APP_SHELL_BOOT } from "./boot-manifest.js";
import { mountAppShell } from "./app-shell-entry.js";
import { mountFaceConsole } from "./face-console.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("web: missing #root");

const consoleMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("console") === "1";

const seed = consoleMode ? FACE_CONSOLE_BOOT : XRK_APP_SHELL_BOOT;

if (!window.__DSH_BOOT__ && !window.__XRK_BOOT__) {
  // Dev vite: seed boot so readBootManifest works without host tap.
  window.__XRK_BOOT__ = seed;
  window.__DSH_BOOT__ = seed;
}

if (consoleMode) {
  mountFaceConsole(root);
} else {
  mountAppShell(root);
}
