#!/usr/bin/env node
/**
 * Launch unpackaged Desktop Electron against the current workspace (ADR-0008).
 *
 *   pnpm dev:desktop              # build:desktop then launch
 *   pnpm start:desktop            # skip build; require existing dist
 *
 * Electron is resolved from `@xrkseek/harness-desktop` when installed; product
 * remains Not done until packaging / Host wiring land (see docs/status.md).
 */
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = path.join(ROOT, "apps", "desktop");
const BUILD_SCRIPT = path.join(ROOT, "scripts", "build-desktop.mjs");

const { values } = parseArgs({
  options: {
    "skip-build": { type: "boolean", default: false },
  },
  strict: true,
});

function runNode(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!values["skip-build"]) {
  runNode(BUILD_SCRIPT);
}

const required = [
  path.join(APP_ROOT, "dist", "main.js"),
  path.join(ROOT, "apps", "desktop-host", "dist", "index.js"),
  path.join(ROOT, "apps", "web", "dist", "index.html"),
];
for (const file of required) {
  if (!existsSync(file)) {
    process.stderr.write(
      `dev-desktop: missing ${path.relative(ROOT, file)} (run pnpm build:desktop)\n`,
    );
    process.exit(1);
  }
}

function resolveElectronBinary() {
  try {
    const require = createRequire(path.join(APP_ROOT, "package.json"));
    const electronPath = require("electron");
    if (typeof electronPath === "string" && existsSync(electronPath)) {
      return electronPath;
    }
  } catch {
    // optional until Desktop packaging lands
  }
  return undefined;
}

const electronBin = resolveElectronBinary();
if (electronBin === undefined) {
  process.stderr.write(
    "dev-desktop: electron is not installed under @xrkseek/harness-desktop yet\n" +
      "  (Desktop product remains Not done — see docs/status.md / ADR-0008).\n" +
      "  TypeScript + web assemble completed when build ran; launch is deferred.\n",
  );
  process.exit(1);
}

const developmentRoot = path.join(APP_ROOT, ".desktop-build", "development");
const userData = path.join(developmentRoot, "electron-user-data");
const child = spawn(electronBin, [APP_ROOT], {
  cwd: APP_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    XRK_DESKTOP_WEB_ROOT:
      process.env.XRK_DESKTOP_WEB_ROOT?.trim() ||
      path.join(ROOT, "apps", "web", "dist"),
    ELECTRON_USER_DATA_DIR: process.env.ELECTRON_USER_DATA_DIR ?? userData,
  },
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
