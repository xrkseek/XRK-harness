/**
 * Landing + Face verifier console (`?console=1`).
 * Full product chat UI is served from the host web dist.
 */

import { FACE_CONSOLE_BOOT } from "./boot-manifest.js";
import { mountFaceConsole } from "./face-console.js";
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
  root.innerHTML = "";
  root.className = "xrk-web-landing";
  root.innerHTML = `
    <img class="mark" src="/logo-plate.png" alt="XRK Harness" width="96" height="96" />
    <h1>XRK Harness</h1>
    <p>完整产品聊天壳由 <code>serve</code> 托管的 web dist 提供。</p>
    <p>本包仅保留 Face 验证台：<a href="/?console=1">/?console=1</a></p>
  `;
}
