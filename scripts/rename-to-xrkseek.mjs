/**
 * Full scrub: @xrkseek/xrk-* (+ cordis thin stack) → @xrkseek/*,
 * stubs/dsh-* → stubs/xrk-*, xrk.client → xrk.client, __XRK_BOOT__ → __XRK_BOOT__.
 *
 * Wire RPC method names (session.prompt etc.) are untouched.
 *
 *   node scripts/rename-to-xrkseek.mjs
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Ordered longest-first so shorter prefixes do not eat longer ones. */
const PACKAGE_REPLACEMENTS = [
  ["@xrkseek/client-", "@xrkseek/client-"],
  ["@xrkseek/web-frontend", "@xrkseek/web-frontend"],
  ["@xrkseek/xrk-", "@xrkseek/xrk-"],
  ["@xrkseek/cordis-plugin-", "@xrkseek/cordis-plugin-"],
  ["@xrkseek/cordis", "@xrkseek/cordis"],
  ["@xrkseek/cosmokit", "@xrkseek/cosmokit"],
  ["@xrkseek/schemastery", "@xrkseek/schemastery"],
];

const TEXT_REPLACEMENTS = [
  ...PACKAGE_REPLACEMENTS,
  ["__XRK_BOOT__", "__XRK_BOOT__"],
  ["XrkWindow", "XrkWindow"],
  ["xrk.client", "xrk.client"],
  ['"xrk":', '"xrk":'],
  ["pkg.xrk", "pkg.xrk"],
  ["package.xrk", "package.xrk"],
  ["xrk-client-bundle-purity", "xrk-client-bundle-purity"],
  [
    "git+https://github.com/xrkseek/XRK-harness.git",
    "git+https://github.com/xrkseek/XRK-harness.git",
  ],
  // bare plugin folder segments used in assemble / tests
  ["client-ui-settings-models", "client-ui-settings-models"],
  ["client-ui-settings-plugins", "client-ui-settings-plugins"],
  ["client-ui-cordis", "client-ui-cordis"],
  ["xrk-cordis-client-runner", "xrk-cordis-client-runner"],
  ["client-hmr", "client-hmr"],
  ["client-runtime", "client-runtime"],
  ["client-ui-conversation", "client-ui-conversation"],
];

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "lib",
  "coverage",
  ".turbo",
  "canvases",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".html",
  ".css",
  ".txt",
  ".i18n.yaml",
]);

function shouldSkip(rel) {
  const parts = rel.split(path.sep);
  return parts.some((p) => SKIP_DIR.has(p));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full);
    if (shouldSkip(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function applyReplacements(text) {
  let out = text;
  for (const [from, to] of TEXT_REPLACEMENTS) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

function renameStubDirs() {
  const stubs = path.join(ROOT, "packages", "stubs");
  if (!existsSync(stubs)) return [];
  const renamed = [];
  for (const name of readdirSync(stubs)) {
    if (!name.startsWith("dsh-")) continue;
    const from = path.join(stubs, name);
    const to = path.join(stubs, name.replace(/^dsh-/, "xrk-"));
    if (existsSync(to)) {
      console.warn(`skip dir rename (exists): ${name} → ${path.basename(to)}`);
      continue;
    }
    renameSync(from, to);
    renamed.push(`${name} → ${path.basename(to)}`);
  }
  return renamed;
}

function main() {
  console.log("1) rename packages/stubs/dsh-* → xrk-*");
  const dirs = renameStubDirs();
  for (const d of dirs) console.log("  ", d);

  console.log("2) rewrite text files");
  const files = walk(ROOT);
  let changed = 0;
  for (const file of files) {
    const ext = path.extname(file);
    if (!TEXT_EXT.has(ext) && !file.endsWith(".i18n.yaml")) continue;
    // skip lockfile — regenerates on install
    if (file.endsWith("pnpm-lock.yaml")) continue;
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const next = applyReplacements(raw);
    if (next !== raw) {
      writeFileSync(file, next);
      changed++;
    }
  }
  console.log(`  updated ${changed} files`);

  console.log("3) sample package names:");
  for (const sample of [
    "packages/client/runtime/package.json",
    "apps/web/package.json",
    "packages/stubs/xrk-session/package.json",
    "packages/cordis/package.json",
  ]) {
    const p = path.join(ROOT, sample);
    if (!existsSync(p)) {
      console.log("  miss", sample);
      continue;
    }
    const name = JSON.parse(readFileSync(p, "utf8")).name;
    console.log(" ", name, "←", sample);
  }
}

main();
