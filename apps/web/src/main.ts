/**
 * Product chat UI is the DeepSeek Harness fork (XRKbar) captured to
 * `vendor/dsh-web-static` and served by `xrk-harness serve`.
 * This Vite app only keeps the Face verifier console (`?console=1`).
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
    <p>产品聊天壳走 <code>vendor/dsh-web-static</code>（DSH fork · XRKbar）。</p>
    <p>本包仅保留 Face 验证台：<a href="/?console=1">/?console=1</a></p>
    <p class="hint">serve 优先托管 dsh-web-static；先 <code>pnpm web:dsh:capture</code>。</p>
  `;
}
