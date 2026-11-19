/** Edge CDP → Host product shell with seeded chat + overview. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.dirname(fileURLToPath(import.meta.url));
const edge =
  process.env.EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9231;
const USER = path.join(outDir, ".edge-profile-host");
const HOST = process.env.HOST_URL || "http://127.0.0.1:18765/";
const SESSION_TITLE = process.env.SESSION_TITLE || "核对 Windows 安装包";

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
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER}`,
    "--no-first-run",
    "about:blank",
  ],
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
  await sleep(800);
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) throw new Error("no page");
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");

  const evalJs = async (expression) => {
    const r = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };

  const shot = async (name) => {
    const { data } = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    const dest = path.join(outDir, name);
    fs.writeFileSync(dest, Buffer.from(data, "base64"));
    console.log(name, fs.statSync(dest).size);
  };

  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });

  await session.send("Page.navigate", { url: HOST });
  await sleep(4500);
  await evalJs(`(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    return document.fonts?.status;
  })()`);

  for (let i = 0; i < 3; i++) {
    const hit = await evalJs(`(() => {
      const labels = ['继续', 'Continue'];
      const btns = [...document.querySelectorAll('button')];
      for (const t of labels) {
        const el = btns.find((x) => (x.textContent || '').trim() === t);
        if (el) { el.click(); return t; }
      }
      return null;
    })()`);
    if (!hit) break;
    await sleep(1000);
  }

  // Expand coding workspace if collapsed, then open seeded session.
  await evalJs(`(() => {
    const nodes = [...document.querySelectorAll('button,[role=button],a,div,span,li')];
    const ws = nodes.find((x) => (x.textContent || '').trim() === 'XRK-harness');
    if (ws) ws.click();
    return !!ws;
  })()`);
  await sleep(1200);

  const opened = await evalJs(`(() => {
    const want = ${JSON.stringify(SESSION_TITLE)};
    const nodes = [...document.querySelectorAll('button,[role=button],a,[role=option],li,div,span')];
    // Prefer the smallest leaf whose visible text equals / starts with the title.
    const scored = nodes
      .map((el) => {
        const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!t) return null;
        if (!(t === want || t.startsWith(want))) return null;
        return { el, t, len: t.length };
      })
      .filter(Boolean)
      .sort((a, b) => a.len - b.len);
    const hit = scored[0];
    if (!hit) return null;
    hit.el.click();
    return hit.t.slice(0, 80);
  })()`);
  console.log("opened", opened);
  await sleep(3500);

  // If still on empty hero, try deep query by title again after expand.
  const stillEmpty = await evalJs(`(() => {
    const t = (document.body.innerText || '');
    return t.includes('描述你想要构建的内容') && !t.includes('本地优先');
  })()`);
  console.log("stillEmpty", stillEmpty);
  if (stillEmpty) {
    await evalJs(`(() => {
      const want = ${JSON.stringify(SESSION_TITLE)};
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let best = null;
      while (walk.nextNode()) {
        const el = walk.currentNode;
        const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t === want || (t.startsWith(want) && t.length < want.length + 12)) {
          if (!best || t.length < best.t.length) best = { el, t };
        }
      }
      if (best) best.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return best ? best.t : null;
    })()`);
    await sleep(3500);
  }

  const body = await evalJs(
    `(() => ((document.body && document.body.innerText) || '').slice(0, 320).replace(/\\s+/g, ' '))()`,
  );
  console.log("body", body);

  await shot("host-shell.png");
  await shot("host-chat.png");

  // Open Overview / 概况 (preview panel).
  const overview = await evalJs(`(() => {
    const labels = ['概况', 'Overview'];
    const nodes = [...document.querySelectorAll('button,[role=tab],[role=button],a')];
    for (const t of labels) {
      const el = nodes.find((x) => (x.textContent || '').trim() === t);
      if (el) { el.click(); return t; }
    }
    return null;
  })()`);
  console.log("overview", overview);
  await sleep(2500);
  await shot("host-overview.png");

  // Presence / emotion stage often lives under overview — click canvas/stage if present.
  await evalJs(`(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.scrollIntoView({ block: 'center' });
    return !!canvas;
  })()`);
  await sleep(800);
  await shot("host-presence.png");

  // Settings (clean, after chat).
  await evalJs(`(() => {
    const el = [...document.querySelectorAll('button,[role=button],a')].find((x) => {
      const txt = (x.textContent || '').trim();
      const aria = (x.getAttribute('aria-label') || '').trim();
      return txt === '设置' || aria === '设置' || txt === 'Settings' || aria === 'Settings';
    });
    if (el) el.click();
    return !!el;
  })()`);
  await sleep(2000);
  await shot("host-settings.png");

  await evalJs(`(() => {
    const el = [...document.querySelectorAll('button,[role=tab],[role=button],a')].find(
      (x) => (x.textContent || '').trim() === '模型' || (x.textContent || '').trim() === 'Models'
    );
    if (el) el.click();
    return !!el;
  })()`);
  await sleep(1600);
  await shot("host-models.png");

  session.close();
} finally {
  try {
    process.kill(child.pid);
  } catch {
    /* ignore */
  }
}

console.log(
  "files",
  fs.readdirSync(outDir).filter((n) => n.endsWith(".png")),
);
