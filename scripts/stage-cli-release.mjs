#!/usr/bin/env node
/**
 * Stage @xrkseek/harness-cli → .release/
 * - harness-cli/     deploy 树（给 npm pack / npmjs）
 * - xrkseek-harness-cli-<ver>.tgz   发行版（给 GitHub Release）
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
const CLI = path.join(ROOT, "apps", "cli");
const WEB_DIST = path.join(ROOT, "apps", "web", "dist");
const PRODUCT_WEB = path.join(CLI, "product-web");
const STAGE = path.join(ROOT, ".release", "harness-cli");

function run(cmd, args, cwd = ROOT, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** npm via node npm-cli.js — same argv on Windows / Linux / macOS (no shell). */
function npmSpawn(args, opts = {}) {
  const npmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const cmd = existsSync(npmCli) ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const npmArgs = existsSync(npmCli) ? [npmCli, ...args] : args;
  return spawnSync(cmd, npmArgs, {
    cwd: opts.cwd ?? ROOT,
    encoding: opts.encoding ?? "utf8",
    stdio: opts.stdio ?? "pipe",
    shell: false,
    env: { ...process.env, ...opts.env },
  });
}

function extractTarGz(tgzPath, destDir) {
  run("tar", ["-xzf", tgzPath, "-C", destDir, "--strip-components=1"]);
}

/** After staging on any OS, npm global installs must find these sharp runtimes. */
const SHARP_PLATFORM_SPOT_CHECKS = [
  "@img/sharp-linux-x64",
  "@img/sharp-libvips-linux-x64",
  "@img/sharp-darwin-arm64",
  "@img/sharp-darwin-x64",
  "@img/sharp-win32-x64",
];

/** pnpm deploy 用 junction；tar/npm 装完解析不到嵌套包。把 .pnpm 里的包抬到 node_modules 顶层。 */
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
      for (const pkg of readdirSync(full)) {
        names.push(`${name}/${pkg}`);
      }
    } else names.push(name);
  }
  return names;
}

/**
 * pnpm deploy on one OS only installs that host's sharp optional binaries.
 * Stage on Windows / Linux / macOS: npm pack + tar pulls every missing @img/* optional.
 */
function bundleSharpPlatforms(stageDir) {
  const sharpPkgPath = path.join(stageDir, "node_modules", "sharp", "package.json");
  if (!existsSync(sharpPkgPath)) return;

  const sharpPkg = JSON.parse(readFileSync(sharpPkgPath, "utf8").replace(/^\uFEFF/, ""));
  const optional = sharpPkg.optionalDependencies ?? {};
  const missing = [];
  for (const [name, ver] of Object.entries(optional)) {
    if (!name.startsWith("@img/")) continue;
    const pkgPath = path.join(stageDir, "node_modules", ...name.split("/"), "package.json");
    if (!existsSync(pkgPath)) missing.push([name, ver]);
  }
  if (missing.length === 0) return;

  const tmp = path.join(stageDir, ".sharp-platform-bundle");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  console.log(`stage: bundling ${missing.length} sharp platform packages (${process.platform})`);
  let sharpIndex = 0;
  for (const [name, ver] of missing) {
    sharpIndex += 1;
    console.log(`stage: sharp [${sharpIndex}/${missing.length}] ${name}@${ver}`);
    const pack = npmSpawn(["pack", `${name}@${ver}`, "--pack-destination", tmp], { cwd: tmp });
    if (pack.status !== 0) {
      console.error(`stage: npm pack failed for ${name}@${ver}`);
      process.stderr.write(pack.stderr || pack.stdout || "");
      process.exit(pack.status ?? 1);
    }
    const tgz = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!tgz) {
      console.error(`stage: npm pack produced no tarball for ${name}@${ver}`);
      process.exit(1);
    }
    const tgzPath = path.isAbsolute(tgz) ? tgz : path.join(tmp, tgz);
    const dest = path.join(stageDir, "node_modules", ...name.split("/"));
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    extractTarGz(tgzPath, dest);
    rmSync(tgzPath, { force: true });
  }
  rmSync(tmp, { recursive: true, force: true });

  for (const required of SHARP_PLATFORM_SPOT_CHECKS) {
    const pkgPath = path.join(stageDir, "node_modules", ...required.split("/"), "package.json");
    if (!existsSync(pkgPath)) {
      console.error(`stage: missing ${required} after sharp platform bundle`);
      process.exit(1);
    }
  }
}

/** pnpm deploy omits gitignored dist/; copy compiled context runtime into the bundle. */
function syncContextDistIntoStage(stageDir) {
  const pairs = [
    ["packages/context/file-reference/dist", "node_modules/@xrkseek/xrk-file-reference/dist"],
    [
      "packages/context/file-reference-local/dist",
      "node_modules/@xrkseek/xrk-file-reference-local/dist",
    ],
    ["packages/context/session-reference/dist", "node_modules/@xrkseek/xrk-session-reference/dist"],
  ];
  for (const [srcRel, destRel] of pairs) {
    const src = path.join(ROOT, srcRel);
    const dest = path.join(stageDir, destRel);
    if (!existsSync(src)) {
      console.error(`stage: missing workspace context build ${srcRel}`);
      process.exit(1);
    }
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

run("pnpm", ["exec", "tsc", "-b", "apps/cli", "--pretty", "false"]);

const CONTEXT_RUNTIME = [
  "packages/context/file-reference/dist/grammar.js",
  "packages/context/file-reference-local/dist/search.js",
  "packages/context/session-reference/dist/uri.js",
];
for (const rel of CONTEXT_RUNTIME) {
  if (!existsSync(path.join(ROOT, rel))) {
    console.error(`stage: missing context runtime ${rel} (tsc -b apps/cli)`);
    process.exit(1);
  }
}

run("pnpm", ["web:build"]);
run("pnpm", ["client:bundle"]);
run("pnpm", ["web:assemble"]);

if (!existsSync(path.join(WEB_DIST, "index.html"))) {
  console.error("stage: missing apps/web/dist/index.html");
  process.exit(1);
}

rmSync(PRODUCT_WEB, { recursive: true, force: true });
cpSync(WEB_DIST, PRODUCT_WEB, { recursive: true });

rmSync(path.join(ROOT, ".release"), { recursive: true, force: true });
mkdirSync(path.join(ROOT, ".release"), { recursive: true });

run("pnpm", ["--filter", "@xrkseek/harness-cli", "deploy", "--prod", "--legacy", STAGE], ROOT, {
  CI: "true",
  npm_config_confirm_modules_purge: "false",
});

if (!existsSync(path.join(STAGE, "product-web", "index.html"))) {
  console.error("stage: deploy missed product-web/");
  process.exit(1);
}

const SEEDS = path.join(CLI, "seeds");
if (existsSync(SEEDS)) {
  cpSync(SEEDS, path.join(STAGE, "seeds"), { recursive: true });
} else {
  console.error("stage: missing apps/cli/seeds/");
  process.exit(1);
}
if (!existsSync(path.join(STAGE, "seeds", "skills", "xrk-capability-attach", "SKILL.md"))) {
  console.error("stage: seeds/skills/xrk-capability-attach missing");
  process.exit(1);
}

const stagedPkgPath = path.join(STAGE, "package.json");
const staged = JSON.parse(readFileSync(stagedPkgPath, "utf8").replace(/^\uFEFF/, ""));
delete staged.private;
hoistPnpmStore(path.join(STAGE, "node_modules"));
rmSync(path.join(STAGE, "node_modules", ".pnpm"), { recursive: true, force: true });
syncContextDistIntoStage(STAGE);
bundleSharpPlatforms(STAGE);

for (const rel of [
  "node_modules/@xrkseek/xrk-file-reference/dist/grammar.js",
  "node_modules/@xrkseek/xrk-file-reference-local/dist/search.js",
  "node_modules/@xrkseek/xrk-session-reference/dist/uri.js",
]) {
  if (!existsSync(path.join(STAGE, rel))) {
    console.error(`stage: bundled context runtime missing ${rel}`);
    process.exit(1);
  }
}

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
staged.files = ["dist", "product-web", "seeds", "README.md"];
staged.publishConfig = {
  access: "public",
  registry: "https://registry.npmjs.org",
};
writeFileSync(stagedPkgPath, `${JSON.stringify(staged, null, 2)}\n`);

// MCP SDK peers must resolve after .pnpm is stripped (npm global / npx).
for (const must of ["zod"]) {
  if (!existsSync(path.join(STAGE, "node_modules", must))) {
    console.error(`stage: missing bundled dependency ${must} after hoist`);
    process.exit(1);
  }
}

const ver = typeof staged.version === "string" ? staged.version : "0.0.0";
const releaseTgz = path.join(ROOT, ".release", `xrkseek-harness-cli-${ver}.tgz`);
run("tar", ["-czf", releaseTgz, "-C", path.join(ROOT, ".release"), "harness-cli"]);

console.log(`stage: release ${releaseTgz}`);
console.log(`stage: npm     ${STAGE}`);
