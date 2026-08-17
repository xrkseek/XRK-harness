/**
 * Capture a built product-web dist + boot graph + /plugins into
 * `apps/web-static` (tracked) for `xrk-harness serve`.
 *
 * Also mirrors to `vendor/web-static` for local-only overrides (gitignored).
 *
 * Expects a local UI source tree at `vendor/ui-src` (gitignore; maintainer link).
 *
 *   pnpm web:ui:build
 *   pnpm web:ui:capture
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
const UI_SRC = path.join(ROOT, "vendor", "ui-src");
const OUT_TRACKED = path.join(ROOT, "apps", "web-static");
const OUT_LOCAL = path.join(ROOT, "vendor", "web-static");
const DIST = path.join(UI_SRC, "apps", "web", "dist");
const URL_BASE = (process.env.XRK_UI_URL ?? "http://127.0.0.1:3080").replace(
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
  throw new Error(`UI not ready at ${URL_BASE}`);
}

async function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    throw new Error(`missing ${DIST}/index.html — run pnpm web:ui:build first`);
  }

  let child;
  let startedHere = false;
  try {
    await fetch(`${URL_BASE}/`);
  } catch {
    startedHere = true;
    child = spawn("pnpm", ["dsh", "web"], {
      cwd: UI_SRC,
      shell: true,
      stdio: "ignore",
      detached: false,
    });
    await waitReady();
  }

  try {
    const html = await fetchText(`${URL_BASE}/`);
    const boot = extractBoot(html);

    for (const OUT of [OUT_TRACKED, OUT_LOCAL]) {
      if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
      mkdirSync(OUT, { recursive: true });
      cpSync(DIST, OUT, { recursive: true });

      for (const name of ["favicon.png", "logo.png", "logo-plate.png"]) {
        const src = path.join(UI_SRC, "apps", "web", "public", name);
        if (existsSync(src)) copyFileSync(src, path.join(OUT, name));
      }

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
        process.stdout.write(`plugin ${entry.id} → ${clean} (${path.basename(OUT)})\n`);
      }

      process.stdout.write(`wrote ${OUT} (rev=${boot.rev})\n`);
    }
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
