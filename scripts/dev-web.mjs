/**
 * Watch client plugin sources and rebuild `lib/client.js` on change.
 * Pair with `xrkh web` during client development (product boot omits HMR).
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
const DEBOUNCE_MS = 400;

let timer;
let bundling = false;
let pending = false;

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

process.stdout.write("dev-web: watching\n");
for (const root of WATCH_ROOTS) {
  watchDir(root);
}
