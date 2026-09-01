#!/usr/bin/env node
/**
 * Stage, then upload:
 * 1. GitHub Release — xrkseek-harness-cli-<ver>.tgz (+ xrkseek-harness-<ver>.tgz SDK)
 * 2. npmjs.org      — @xrkseek/harness-cli · @xrkseek/harness
 *
 * Auth: `gh auth`（Release）；`NPM_TOKEN` 或本机 npm 登录（npmjs）。
 * XRK_RELEASE_SKIP_UPLOAD=1     stage only
 * XRK_RELEASE_SKIP_GH_RELEASE=1 skip GitHub Release
 * XRK_RELEASE_SKIP_NPM=1        skip npmjs
 * XRK_RELEASE_SKIP_PACKAGES=1   旧别名：等同 SKIP_NPM
 * XRK_RELEASE_SKIP_SDK=1        skip SDK stage / npm / Release asset
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = path.join(ROOT, ".release", "harness-cli");
const SDK_STAGE = path.join(ROOT, ".release", "harness");
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

function npmPack(stageDir) {
  const pack = spawnSync("npx", ["--yes", "npm@10.9.2", "pack"], {
    cwd: stageDir,
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
  return path.join(stageDir, npmTgz);
}

function npmOtpArgs() {
  const otp = (process.env.NPM_CONFIG_OTP ?? process.env.NPM_OTP ?? "").trim();
  if (!otp) return [];
  return ["--otp", otp];
}

function npmPublishArgs(packed) {
  return [
    "--yes",
    "npm@10.9.2",
    "publish",
    packed,
    "--access",
    "public",
    "--registry",
    NPMJS,
    ...npmOtpArgs(),
  ];
}

function publishStage(stageDir, label) {
  const packed = npmPack(stageDir);
  const npmToken = process.env.NPM_TOKEN?.trim();
  if (npmToken) {
    writeFileSync(
      path.join(stageDir, ".npmrc"),
      `//registry.npmjs.org/:_authToken=${npmToken}\nregistry=${NPMJS}\n`,
    );
  } else {
    writeFileSync(path.join(stageDir, ".npmrc"), `registry=${NPMJS}\n`);
  }
  console.log(`release: publishing ${label}…`);
  if (!npmOtpArgs().length) {
    console.warn(
      "release: no NPM_CONFIG_OTP / NPM_OTP — publish may fail if account requires 2FA for write actions",
    );
  }
  const pub = spawnSync("npx", npmPublishArgs(packed), {
    cwd: stageDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (pub.status !== 0) {
    console.error(
      `release: npm publish ${label} failed — if EOTP, set NPM_CONFIG_OTP`,
    );
    process.exit(pub.status ?? 1);
  }
  console.log(`release: npmjs ${label} ok`);
}

const skipSdk = process.env.XRK_RELEASE_SKIP_SDK === "1";

run("node", [path.join(ROOT, "scripts", "stage-cli-release.mjs")]);
if (!skipSdk) {
  run("node", [path.join(ROOT, "scripts", "stage-sdk-release.mjs")]);
}

const pkg = JSON.parse(
  readFileSync(path.join(STAGE, "package.json"), "utf8").replace(/^\uFEFF/, ""),
);
const ver = pkg.version;
const tag = `v${ver}`;
const releaseTgz = path.join(ROOT, ".release", `xrkseek-harness-cli-${ver}.tgz`);
const sdkTgz = path.join(ROOT, ".release", `xrkseek-harness-${ver}.tgz`);

if (!existsSync(path.join(STAGE, "product-web", "index.html")) || !existsSync(releaseTgz)) {
  console.error("release: stage incomplete");
  process.exit(1);
}
if (!skipSdk && (!existsSync(path.join(SDK_STAGE, "dist", "index.js")) || !existsSync(sdkTgz))) {
  console.error("release: SDK stage incomplete");
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
  const assets = [releaseTgz];
  if (!skipSdk && existsSync(sdkTgz)) assets.push(sdkTgz);
  const view = spawnSync("gh", ["release", "view", tag], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...ghEnv },
  });
  if (view.status === 0) {
    run("gh", ["release", "upload", tag, ...assets, "--clobber"], { env: ghEnv });
  } else {
    const notesFile = path.join(ROOT, "docs", "releases", `${tag}.md`);
    const createArgs = ["release", "create", tag, ...assets, "--title", tag];
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
  publishStage(STAGE, "@xrkseek/harness-cli");
  if (!skipSdk) publishStage(SDK_STAGE, "@xrkseek/harness");
}

console.log(`release: ${tag} done`);
