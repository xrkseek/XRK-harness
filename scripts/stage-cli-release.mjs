#!/usr/bin/env node
/**
 * Stage @xrkseek/harness-cli for GitHub Release + Packages.
 * Assembles product-web, deploy-closes runtime, writes .release/*.tgz
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

function run(cmd, args, cwd = ROOT) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function walkPkgJson(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "lib" || name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkPkgJson(full, acc);
    else if (name === "package.json") acc.push(full);
  }
  return acc;
}

/** Keep workspace private so only the staged CLI is publishable. */
function ensurePrivateSurface() {
  const files = [
    path.join(ROOT, "package.json"),
    ...walkPkgJson(path.join(ROOT, "packages")),
    ...walkPkgJson(path.join(ROOT, "presets")),
    ...walkPkgJson(path.join(ROOT, "apps")),
  ];
  for (const file of files) {
    const pkg = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (!pkg.name) continue;
    let dirty = false;
    if (pkg.private !== true) {
      pkg.private = true;
      dirty = true;
    }
    if (pkg.publishConfig) {
      delete pkg.publishConfig;
      dirty = true;
    }
    if (dirty) writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

ensurePrivateSurface();
run("pnpm", ["exec", "tsc", "-b", "apps/cli", "--pretty", "false"]);
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

run("pnpm", ["--filter", "@xrkseek/harness-cli", "deploy", "--prod", STAGE]);

const stagedPkgPath = path.join(STAGE, "package.json");
const staged = JSON.parse(readFileSync(stagedPkgPath, "utf8").replace(/^\uFEFF/, ""));
delete staged.private;
staged.publishConfig = {
  access: "public",
  registry: "https://npm.pkg.github.com",
};
staged.bundleDependencies = Object.keys(staged.dependencies ?? {});
writeFileSync(stagedPkgPath, `${JSON.stringify(staged, null, 2)}\n`);

if (!existsSync(path.join(STAGE, "product-web", "index.html"))) {
  console.error("stage: deploy missed product-web/");
  process.exit(1);
}

const ver = typeof staged.version === "string" ? staged.version : "0.0.0";
const releaseTgz = path.join(ROOT, ".release", `xrkseek-harness-cli-${ver}.tgz`);
rmSync(releaseTgz, { force: true });
run("tar", ["-czf", releaseTgz, "-C", path.join(ROOT, ".release"), "harness-cli"]);

const pack = spawnSync(
  "npm",
  ["pack", "--pack-destination", path.join(ROOT, ".release")],
  {
    cwd: STAGE,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  },
);
if (pack.status !== 0) {
  process.stderr.write(pack.stderr || pack.stdout || "");
  process.exit(pack.status ?? 1);
}

console.log(`stage: ${releaseTgz}`);
console.log(`stage: ${STAGE}`);
