#!/usr/bin/env node
/**
 * Mark runtime packages public and point package exports types at dist.
 * Does not npm publish. Skip: stubs, client UI, console, testkit, cordis.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "0.1.0";
const REPO = "git+https://github.com/xrkseek/XRK-harness.git";

const SKIP_DIR_NAMES = new Set([
  "stubs",
  "client",
  "cordis",
  "cordis-core",
  "node_modules",
  "dist",
  "lib",
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name) || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (name === "package.json") acc.push(full);
  }
  return acc;
}

const roots = [
  path.join(ROOT, "packages"),
  path.join(ROOT, "presets"),
  path.join(ROOT, "apps", "cli"),
  path.join(ROOT, "apps", "web"),
];

const files = [];
for (const r of roots) {
  const st = statSync(r);
  if (st.isDirectory() && path.basename(r) !== "cli" && path.basename(r) !== "web") {
    walk(r, files);
  } else if (st.isDirectory()) {
    files.push(path.join(r, "package.json"));
  }
}

const skipNames = new Set([
  "@xrkseek/testkit",
  "@xrkseek/web-runtime",
  "@xrkseek/cosmokit",
  "@xrkseek/schemastery",
]);

let n = 0;
for (const file of files) {
  const rel = path.relative(ROOT, path.dirname(file)).replaceAll("\\", "/");
  if (rel.startsWith("packages/stubs") || rel.startsWith("packages/client")) continue;
  if (rel.includes("/cordis")) continue;

  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (!pkg.name || skipNames.has(pkg.name)) continue;

  pkg.version = VERSION;
  delete pkg.private;
  pkg.license = pkg.license ?? "MIT";
  pkg.publishConfig = { access: "public" };
  pkg.repository = {
    type: "git",
    url: REPO,
    directory: rel,
  };

  if (pkg.exports && typeof pkg.exports === "object" && pkg.exports["."]) {
    const exp = pkg.exports["."];
    if (exp && typeof exp === "object" && typeof exp.types === "string") {
      if (exp.types === "./src/index.ts") exp.types = "./dist/index.d.ts";
      if (exp.types === "./preset.ts") exp.types = "./dist/preset.d.ts";
    }
  }

  if (!pkg.files && pkg.name !== "@xrkseek/web-frontend") {
    pkg.files = ["dist", "README.md"];
  }

  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  n += 1;
  process.stdout.write(`publish-surface: ${pkg.name}\n`);
}

process.stdout.write(`publish-surface: updated ${n} packages → ${VERSION}\n`);
