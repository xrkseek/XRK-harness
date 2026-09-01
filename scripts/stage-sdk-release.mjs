#!/usr/bin/env node
/**
 * Stage @xrkseek/harness (SDK) → .release/harness + xrkseek-harness-<ver>.tgz
 * Embedders (e.g. XRK-AGT) install via npmjs or the GitHub Release tarball —
 * not via sibling `link:../XRK-harness/...`.
 *
 * Version follows apps/cli (same product line as harness-cli).
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PKG = path.join(ROOT, "apps", "cli", "package.json");
const SDK_PKG = path.join(ROOT, "packages", "sdk", "package.json");
const STAGE = path.join(ROOT, ".release", "harness");

function run(cmd, args, cwd = ROOT, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      CI: "true",
      npm_config_confirm_modules_purge: "false",
      ...extraEnv,
    },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** pnpm deploy uses junctions; flatten .pnpm for npm pack consumers. */
function hoistPnpmStore(nm) {
  const pnpmDir = path.join(nm, ".pnpm");
  if (!existsSync(pnpmDir)) return;
  for (const virtual of readdirSync(pnpmDir)) {
    const inner = path.join(pnpmDir, virtual, "node_modules");
    if (!existsSync(inner)) continue;
    for (const name of readdirSync(inner)) {
      if (name === ".bin") continue;
      const src = path.join(inner, name);
      if (name.startsWith("@")) {
        const scopeDest = path.join(nm, name);
        mkdirSync(scopeDest, { recursive: true });
        for (const pkg of readdirSync(src)) {
          const dest = path.join(scopeDest, pkg);
          rmSync(dest, { recursive: true, force: true });
          cpSync(path.join(src, pkg), dest, { recursive: true, dereference: true });
        }
      } else {
        const dest = path.join(nm, name);
        rmSync(dest, { recursive: true, force: true });
        cpSync(src, dest, { recursive: true, dereference: true });
      }
    }
  }
}

function bundledNames(nm) {
  const names = [];
  for (const name of readdirSync(nm)) {
    if (name.startsWith(".") || name === ".bin") continue;
    const full = path.join(nm, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("@")) {
      for (const pkg of readdirSync(full)) names.push(`${name}/${pkg}`);
    } else names.push(name);
  }
  return names;
}

const cliVer = JSON.parse(readFileSync(CLI_PKG, "utf8").replace(/^\uFEFF/, "")).version;
if (typeof cliVer !== "string" || !cliVer) {
  console.error("stage-sdk: apps/cli version missing");
  process.exit(1);
}

const sdkSrc = JSON.parse(readFileSync(SDK_PKG, "utf8").replace(/^\uFEFF/, ""));
if (sdkSrc.version !== cliVer) {
  sdkSrc.version = cliVer;
  writeFileSync(SDK_PKG, `${JSON.stringify(sdkSrc, null, 2)}\n`);
  console.log(`stage-sdk: synced packages/sdk version → ${cliVer}`);
}

run("pnpm", ["--filter", "@xrkseek/harness...", "run", "--if-present", "build"], ROOT);

if (!existsSync(path.join(ROOT, "packages", "sdk", "dist", "index.js"))) {
  console.error("stage-sdk: missing packages/sdk/dist/index.js — run pnpm build first");
  process.exit(1);
}

mkdirSync(path.join(ROOT, ".release"), { recursive: true });
rmSync(STAGE, { recursive: true, force: true });

run("pnpm", ["--filter", "@xrkseek/harness", "deploy", "--prod", "--legacy", STAGE], ROOT);

if (!existsSync(path.join(STAGE, "dist", "index.js"))) {
  console.error("stage-sdk: deploy missed dist/index.js");
  process.exit(1);
}

const stagedPkgPath = path.join(STAGE, "package.json");
const staged = JSON.parse(readFileSync(stagedPkgPath, "utf8").replace(/^\uFEFF/, ""));
delete staged.private;
staged.version = cliVer;
hoistPnpmStore(path.join(STAGE, "node_modules"));
rmSync(path.join(STAGE, "node_modules", ".pnpm"), { recursive: true, force: true });

const names = bundledNames(path.join(STAGE, "node_modules"));
const dependencies = {};
for (const n of names) {
  const pj = path.join(STAGE, "node_modules", ...n.split("/"), "package.json");
  let v = "0.0.0";
  if (existsSync(pj)) {
    const p = JSON.parse(readFileSync(pj, "utf8").replace(/^\uFEFF/, ""));
    if (typeof p.version === "string") v = p.version;
  }
  dependencies[n] = v;
}
staged.dependencies = dependencies;
staged.bundleDependencies = names;
staged.files = ["dist", "README.md", "node_modules"];
staged.description =
  staged.description ||
  "XRK-Harness public SDK — createAgent, session, tools, LLM adapters (embeddable).";
staged.publishConfig = {
  access: "public",
  registry: "https://registry.npmjs.org",
};
writeFileSync(stagedPkgPath, `${JSON.stringify(staged, null, 2)}\n`);

const releaseTgz = path.join(ROOT, ".release", `xrkseek-harness-${cliVer}.tgz`);
rmSync(releaseTgz, { force: true });
run("tar", ["-czf", releaseTgz, "-C", path.join(ROOT, ".release"), "harness"]);

console.log(`stage-sdk: release ${releaseTgz}`);
console.log(`stage-sdk: npm     ${STAGE}`);
console.log(`stage-sdk: publish with: npx npm@10 publish ${STAGE} --access public`);
