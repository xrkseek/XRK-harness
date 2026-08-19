/**
 * Landing + Face verifier (`?console=1`).
 * Product chat UI: `apps/web/dist` (serve default).
 */

import { FACE_CONSOLE_BOOT } from "./boot-manifest.js";
import { mountFaceConsole } from "./face-console.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("web: missing #root");

const params =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
const consoleMode = params.get("console") === "1";

if (!window.__XRK_BOOT__ && !window.__XRK_BOOT__) {
  window.__XRK_BOOT__ = FACE_CONSOLE_BOOT;
  window.__XRK_BOOT__ = FACE_CONSOLE_BOOT;
}

if (consoleMode) {
  mountFaceConsole(root);
} else {
  root.innerHTML = "";
  root.className = "xrk-web-landing";
  root.innerHTML = `
    <img class="mark" src="/logo-plate.png" alt="XRK Harness" width="96" height="96" />
    <h1>XRK Harness</h1>
    <p>产品聊天壳由 <code>serve</code> 托管的 <code>apps/web/dist</code> 提供。</p>
    <p>本包：Face 验证台 <a href="/?console=1">/?console=1</a></p>
  `;
}
