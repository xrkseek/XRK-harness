/**
 * Product chat shell (default) + Face verifier (`?console=1`).
 */

import { FACE_CONSOLE_BOOT } from "./boot-manifest.js";
import { mountFaceConsole } from "./face-console.js";
import { mountChatShell } from "./shell/chat-shell.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("web: missing #root");

const consoleMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("console") === "1";

if (!window.__DSH_BOOT__ && !window.__XRK_BOOT__) {
  window.__XRK_BOOT__ = FACE_CONSOLE_BOOT;
  window.__DSH_BOOT__ = FACE_CONSOLE_BOOT;
}

if (consoleMode) {
  mountFaceConsole(root);
} else {
  mountChatShell(root);
}
