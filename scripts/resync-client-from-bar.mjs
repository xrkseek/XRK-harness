/**
 * Copy product-shell client sources from XRKbar/deepseek-harness with scope remaps.
 *
 *   node scripts/resync-client-from-bar.mjs ui-attachment ui-conversation
 *
 * Remap rules (order matters):
 *   @deepseek-ai/dsh-client-*  →  @xrkseek/client-*
 *   @deepseek-ai/dsh-*         →  @xrkseek/xrk-*
 *   @deepseek-ai/cordis        →  @xrkseek/cordis
 *
 * Preserves harness-only paths listed in KEEP_FILES (never overwritten).
 * Post-sync patches listed in PATCH_AFTER run on the harness tree.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BAR =
  process.env.XRK_BAR_ROOT?.trim() ||
  path.join(process.env.USERPROFILE || "", "Desktop", "XRKbar", "deepseek-harness");
const CLIENT = path.join(ROOT, "packages", "client");

const REMAP = [
  [/@deepseek-ai\/dsh-client-/g, "@xrkseek/client-"],
  [/@deepseek-ai\/dsh-/g, "@xrkseek/xrk-"],
  [/@deepseek-ai\/cordis/g, "@xrkseek/cordis"],
  [/@deepseek-ai\//g, "@xrkseek/"],
  [/git\+https:\/\/github\.com\/deepseek-ai\/deepseek-harness/g, "git+https://github.com/xrkseek/XRK-harness"],
  [/DeepSeek Harness/g, "XRK-Harness"],
  [/"dsh"\s*:/g, '"xrk":'],
  [/process\.env\.DSH_/g, "process.env.XRK_"],
  [/__DSH_/g, "__XRK_"],
];

/** Harness-only files: never delete or overwrite during resync. */
const KEEP_FILES = new Map([
  [
    "ui-conversation",
    new Set([
      "src/client/image-limits-projection.ts",
    ]),
  ],
  [
    "ui-settings-models",
    new Set(["src/onboarding-copy.ts"]),
  ],
]);

/** Literal replacements after remap (harness identity). Keys are pkg-relative. */
const PATCH_AFTER = new Map([
  [
    "ui-conversation",
    [
      ["src/client/stores.ts", [["persist: 'dsh.conversation.chat'", "persist: 'xrk.conversation.chat'"]]],
    ],
  ],
]);

function remap(text) {
  let out = text;
  for (const [from, to] of REMAP) out = out.replace(from, to);
  return out;
}

function copyTree(srcDir, destDir, keepRelative) {
  if (!existsSync(srcDir)) throw new Error(`missing bar path: ${srcDir}`);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  const walk = (rel) => {
    const src = path.join(srcDir, rel);
    for (const name of readdirSync(src)) {
      const relPath = rel ? `${rel}/${name}` : name;
      if (keepRelative.has(relPath)) {
        process.stdout.write(`  keep ${relPath}\n`);
        continue;
      }
      const srcPath = path.join(src, name);
      const destPath = path.join(destDir, relPath);
      if (statSync(srcPath).isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        walk(relPath);
      } else if (/\.(ts|tsx|css|json|md|yaml|mjs)$/.test(name)) {
        writeFileSync(destPath, remap(readFileSync(srcPath, "utf8")), "utf8");
      } else {
        cpSync(srcPath, destPath);
      }
    }
  };
  walk("");
}

function backupKept(pkg, pkgDir, keepRelative) {
  const backupRoot = path.join(ROOT, ".xrk-resync-keep", pkg);
  rmSync(backupRoot, { recursive: true, force: true });
  for (const rel of keepRelative) {
    const from = path.join(pkgDir, rel);
    if (!existsSync(from)) continue;
    const to = path.join(backupRoot, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

function restoreKept(pkg, pkgDir, keepRelative) {
  const backupRoot = path.join(ROOT, ".xrk-resync-keep", pkg);
  if (!existsSync(backupRoot)) return;
  for (const rel of keepRelative) {
    const from = path.join(backupRoot, rel);
    const to = path.join(pkgDir, rel);
    if (!existsSync(from)) continue;
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to);
    process.stdout.write(`  restored ${rel}\n`);
  }
  rmSync(backupRoot, { recursive: true, force: true });
}

function applyPatches(pkg) {
  const entries = PATCH_AFTER.get(pkg);
  if (!entries) return;
  for (const [rel, pairs] of entries) {
    const file = path.join(CLIENT, pkg, rel);
    if (!existsSync(file)) continue;
    let text = readFileSync(file, "utf8");
    let changed = false;
    for (const [from, to] of pairs) {
      if (text.includes(from)) {
        text = text.split(from).join(to);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(file, text, "utf8");
      process.stdout.write(`  patched ${rel}\n`);
    }
  }
}

/** Remap bar package.json into harness naming; keep private:true. */
function syncPackageJson(name) {
  const barFile = path.join(BAR, "packages", "client", name, "package.json");
  const harnessFile = path.join(CLIENT, name, "package.json");
  if (!existsSync(barFile) || !existsSync(harnessFile)) return;
  const bar = JSON.parse(readFileSync(barFile, "utf8"));
  const harness = JSON.parse(readFileSync(harnessFile, "utf8"));
  const remapped = JSON.parse(remap(JSON.stringify(bar)));
  // Preserve harness identity fields; take bar structure for exports/xrk/deps.
  const next = {
    ...remapped,
    name: harness.name,
    version: harness.version ?? remapped.version,
    private: true,
    repository: harness.repository,
  };
  delete next.publishConfig;
  writeFileSync(harnessFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  process.stdout.write(`  package.json\n`);
}

function syncPackage(name) {
  const barPkg = path.join(BAR, "packages", "client", name);
  const harnessPkg = path.join(CLIENT, name);
  if (!existsSync(barPkg)) throw new Error(`bar package missing: ${name}`);
  if (!existsSync(harnessPkg)) throw new Error(`harness package missing: ${name}`);

  const keep = KEEP_FILES.get(name) ?? new Set();
  process.stdout.write(`\n== ${name} ==\n`);
  backupKept(name, harnessPkg, keep);

  for (const sub of ["src", "tests"]) {
    const barSub = path.join(barPkg, sub);
    if (!existsSync(barSub)) continue;
    // keep paths are package-relative (`src/...`); strip the `src/`/`tests/` prefix for the subtree keep set
    const prefix = `${sub}/`;
    const keepInSub = new Set(
      [...keep].filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length)),
    );
    copyTree(barSub, path.join(harnessPkg, sub), keepInSub);
  }

  restoreKept(name, harnessPkg, keep);

  for (const leaf of ["tsdown.config.ts", "README.md", "README.zh.md", "README.i18n.yaml"]) {
    const barFile = path.join(barPkg, leaf);
    if (!existsSync(barFile)) continue;
    writeFileSync(path.join(harnessPkg, leaf), remap(readFileSync(barFile, "utf8")), "utf8");
    process.stdout.write(`  ${leaf}\n`);
  }

  syncPackageJson(name);
  applyPatches(name);
}

const pkgs = process.argv.slice(2);
if (!pkgs.length) {
  console.error("usage: node scripts/resync-client-from-bar.mjs <package>...");
  process.exit(1);
}
if (!existsSync(BAR)) {
  console.error(`bar root not found: ${BAR}`);
  process.exit(1);
}

for (const pkg of pkgs) syncPackage(pkg);
process.stdout.write("\ndone\n");
