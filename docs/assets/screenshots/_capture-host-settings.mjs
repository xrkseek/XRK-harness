/** Quick Host settings shot after welcome already dismissed. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.dirname(fileURLToPath(import.meta.url));
const edge =
  process.env.EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9232;
const USER = path.join(outDir, ".edge-profile-host");
const HOST = process.env.HOST_URL || "http://127.0.0.1:18765/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(port, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => {
        s.end();
        resolve(true);
      });
      s.on("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`port ${port} not up`);
}

fs.mkdirSync(USER, { recursive: true });
const child = spawn(
  edge,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER}`, "--no-first-run", "about:blank"],
  { stdio: "ignore", detached: true },
);
child.unref();

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let next = 1;
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  return {
    ready,
    close: () => ws.close(),
    send(method, params = {}) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

try {
  await waitPort(PORT);
  await sleep(600);
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session.send("Page.navigate", { url: HOST });
  await sleep(3500);

  await session.send("Runtime.evaluate", {
    expression: `(() => {
      const el = [...document.querySelectorAll('button,[role=button],a')].find((x) => {
        const txt = (x.textContent || '').trim();
        const aria = (x.getAttribute('aria-label') || '').trim();
        return txt === '设置' || aria === '设置' || txt === 'Settings' || aria === 'Settings';
      });
      if (el) el.click();
      return !!el;
    })()`,
    returnByValue: true,
  });
  await sleep(2000);
  const { data } = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  fs.writeFileSync(path.join(outDir, "host-settings.png"), Buffer.from(data, "base64"));
  console.log("host-settings.png", fs.statSync(path.join(outDir, "host-settings.png")).size);

  await session.send("Runtime.evaluate", {
    expression: `(() => {
      const el = [...document.querySelectorAll('button,[role=tab],[role=button],a')].find(
        (x) => (x.textContent || '').trim() === '模型' || (x.textContent || '').trim() === 'Models'
      );
      if (el) el.click();
      return !!el;
    })()`,
    returnByValue: true,
  });
  await sleep(1800);
  const models = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  fs.writeFileSync(path.join(outDir, "host-models.png"), Buffer.from(models.data, "base64"));
  console.log("host-models.png", fs.statSync(path.join(outDir, "host-models.png")).size);
  session.close();
} finally {
  try {
    process.kill(child.pid);
  } catch {}
}
