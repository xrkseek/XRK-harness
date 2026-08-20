#!/usr/bin/env node
/**
 * Stage, then upload:
 * 1. GitHub Release — xrkseek-harness-cli-<ver>.tgz
 * 2. npmjs.org      — @xrkseek/harness-cli
 *
 * Auth: `gh auth`（Release）；`NPM_TOKEN` 或本机 npm 登录（npmjs）。
 * XRK_RELEASE_SKIP_UPLOAD=1     stage only
 * XRK_RELEASE_SKIP_GH_RELEASE=1 skip GitHub Release
 * XRK_RELEASE_SKIP_NPM=1        skip npmjs
 * XRK_RELEASE_SKIP_PACKAGES=1   旧别名：等同 SKIP_NPM
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = path.join(ROOT, ".release", "harness-cli");
const NPMJS = "https://registry.npmjs.org";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function ghToken() {
  return (
    process.env.GITHUB_TOKEN ||
    spawnSync("gh", ["auth", "token"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    }).stdout?.trim()
  );
}

function npmPack() {
  const pack = spawnSync("npx", ["--yes", "npm@10.9.2", "pack"], {
    cwd: STAGE,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (pack.status !== 0) {
    process.stderr.write(pack.stderr || pack.stdout || "");
    process.exit(pack.status ?? 1);
  }
  const npmTgz = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!npmTgz) {
    console.error("release: npm pack produced no tarball");
    process.exit(1);
  }
  return path.join(STAGE, npmTgz);
}

run("node", [path.join(ROOT, "scripts", "stage-cli-release.mjs")]);

const pkg = JSON.parse(
  readFileSync(path.join(STAGE, "package.json"), "utf8").replace(/^\uFEFF/, ""),
);
const ver = pkg.version;
const tag = `v${ver}`;
const releaseTgz = path.join(ROOT, ".release", `xrkseek-harness-cli-${ver}.tgz`);

if (!existsSync(path.join(STAGE, "product-web", "index.html")) || !existsSync(releaseTgz)) {
  console.error("release: stage incomplete");
  process.exit(1);
}

if (process.env.XRK_RELEASE_SKIP_UPLOAD === "1") {
  console.log(`release: staged ${tag}`);
  process.exit(0);
}

const skipGhRelease = process.env.XRK_RELEASE_SKIP_GH_RELEASE === "1";
const skipNpmjs =
  process.env.XRK_RELEASE_SKIP_NPM === "1" ||
  process.env.XRK_RELEASE_SKIP_PACKAGES === "1";

if (!skipGhRelease) {
  const token = ghToken();
  if (!token) {
    console.error("release: gh auth login (or GITHUB_TOKEN)");
    process.exit(1);
  }
  const ghEnv = { GH_TOKEN: token, GITHUB_TOKEN: token };
  const view = spawnSync("gh", ["release", "view", tag], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...ghEnv },
  });
  if (view.status === 0) {
    run("gh", ["release", "upload", tag, releaseTgz, "--clobber"], { env: ghEnv });
  } else {
    const notesFile = path.join(ROOT, "docs", "releases", `${tag}.md`);
    const createArgs = ["release", "create", tag, releaseTgz, "--title", tag];
    if (existsSync(notesFile)) {
      createArgs.push("--notes-file", notesFile);
    } else {
      createArgs.push("--generate-notes");
    }
    run("gh", createArgs, { env: ghEnv });
  }
  console.log(`release: GitHub Release ${tag} ok`);
}

if (!skipNpmjs) {
  const packed = npmPack();
  const npmToken = process.env.NPM_TOKEN?.trim();
  if (npmToken) {
    writeFileSync(
      path.join(STAGE, ".npmrc"),
      `//registry.npmjs.org/:_authToken=${npmToken}\nregistry=${NPMJS}\n`,
    );
  } else {
    writeFileSync(path.join(STAGE, ".npmrc"), `registry=${NPMJS}\n`);
  }
  console.log("release: publishing npmjs…");
  run(
    "npx",
    [
      "--yes",
      "npm@10.9.2",
      "publish",
      packed,
      "--access",
      "public",
      "--registry",
      NPMJS,
    ],
    { cwd: STAGE, env: process.env },
  );
  console.log("release: npmjs ok");
}

console.log(`release: ${tag} done`);
