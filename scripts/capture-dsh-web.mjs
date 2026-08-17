/**
 * Capture DeepSeek Harness web dist + boot graph + /plugins bundles so XRK
 * `serve` can host the forked UI without Cordis webserver.
 *
 * Usage (DSH already built):
 *   node scripts/capture-dsh-web.mjs
 *   # optional: DSH_WEB_URL=http://127.0.0.1:3080
 *
 * Writes: vendor/dsh-web-static/{index.html assets, plugins/, boot.json}
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DSH = path.join(ROOT, "vendor", "deepseek-harness");
const OUT = path.join(ROOT, "vendor", "dsh-web-static");
const DIST = path.join(DSH, "apps", "web", "dist");
const URL_BASE = (process.env.DSH_WEB_URL ?? "http://127.0.0.1:3080").replace(
  /\/$/,
  "",
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractBoot(html) {
  const m = html.match(
    /window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (!m?.[1]) throw new Error("no window.__DSH_BOOT__ in index.html");
  return JSON.parse(m[1]);
}

async function waitReady(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${URL_BASE}/`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(800);
  }
  throw new Error(`dsh web not ready at ${URL_BASE}`);
}

async function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    throw new Error(`missing ${DIST}/index.html — run pnpm web:dsh:build first`);
  }

  let child;
  let startedHere = false;
  try {
    await fetch(`${URL_BASE}/`);
  } catch {
    startedHere = true;
    child = spawn("pnpm", ["dsh", "web"], {
      cwd: DSH,
      shell: true,
      stdio: "ignore",
      detached: false,
    });
    await waitReady();
  }

  try {
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    cpSync(DIST, OUT, { recursive: true });

    // Prefer freshly branded public assets if present on source tree
    for (const name of ["favicon.png", "logo.png", "logo-plate.png"]) {
      const src = path.join(DSH, "apps", "web", "public", name);
      if (existsSync(src)) copyFileSync(src, path.join(OUT, name));
    }

    const html = await fetchText(`${URL_BASE}/`);
    const boot = extractBoot(html);
    writeFileSync(path.join(OUT, "boot.json"), JSON.stringify(boot, null, 2));

    const pluginsRoot = path.join(OUT, "plugins");
    mkdirSync(pluginsRoot, { recursive: true });
    for (const entry of boot.entries ?? []) {
      const urlPath = String(entry.url ?? "");
      if (!urlPath.startsWith("/plugins/")) continue;
      const clean = urlPath.split("?")[0];
      const dest = path.join(OUT, clean.replace(/^\//, ""));
      mkdirSync(path.dirname(dest), { recursive: true });
      const buf = await fetchBuf(`${URL_BASE}${urlPath}`);
      writeFileSync(dest, buf);
      process.stdout.write(`plugin ${entry.id} → ${clean}\n`);
    }

    process.stdout.write(`wrote ${OUT} (rev=${boot.rev})\n`);
  } finally {
    if (startedHere && child) {
      child.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
