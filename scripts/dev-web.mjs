/**
 * Watch client plugin sources and rebuild `lib/client.js` on change, then
 * re-assemble into `apps/web/dist/plugins` so `xrkh web` serves fresh bundles
 * (static Host reads dist, not packages/*/lib).
 */
import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WATCH_ROOTS = [
  path.join(ROOT, "packages", "client"),
  path.join(ROOT, "packages", "stubs"),
];
const BUNDLE = path.join(ROOT, "scripts", "bundle-client-js.mjs");
const ASSEMBLE = path.join(ROOT, "scripts", "assemble-web-dist.mjs");
const DEBOUNCE_MS = 400;

let timer;
let bundling = false;
let pending = false;

function runAssemble() {
  const distIndex = path.join(ROOT, "apps", "web", "dist", "index.html");
  if (!existsSync(distIndex)) {
    process.stdout.write(
      "dev-web: skip assemble (no apps/web/dist — run pnpm web:build once)\n",
    );
    return;
  }
  const child = spawn(process.execPath, [ASSEMBLE], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      process.stderr.write(`dev-web: assemble failed (exit ${code ?? "spawn"})\n`);
    } else {
      process.stdout.write("dev-web: apps/web/dist plugins synced\n");
    }
  });
}

function runBundle() {
  if (bundling) {
    pending = true;
    return;
  }
  bundling = true;
  const child = spawn(process.execPath, [BUNDLE], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    bundling = false;
    if (code !== 0) {
      process.stderr.write(`dev-web: bundle failed (exit ${code ?? "spawn"})\n`);
    } else {
      process.stdout.write("dev-web: client bundles updated\n");
      runAssemble();
    }
    if (pending) {
      pending = false;
      scheduleBundle();
    }
  });
}

function scheduleBundle() {
  clearTimeout(timer);
  timer = setTimeout(runBundle, DEBOUNCE_MS);
}

function watchDir(dir) {
  if (!existsSync(dir)) return;
  watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const normalized = filename.replace(/\\/g, "/");
    if (
      !normalized.includes("/src/client/") &&
      !normalized.endsWith("/src/client") &&
      !normalized.includes("/src/styles/")
    ) {
      return;
    }
    process.stdout.write(`dev-web: change ${normalized}\n`);
    scheduleBundle();
  });
}

process.stdout.write("dev-web: watching (+ assemble → apps/web/dist)\n");
for (const root of WATCH_ROOTS) {
  watchDir(root);
}
