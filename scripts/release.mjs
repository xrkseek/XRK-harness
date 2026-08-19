#!/usr/bin/env node
/**
 * Stage, then upload:
 * - GitHub Release: ONLY xrkseek-harness-cli-<ver>.tgz (发行版)
 * - GitHub Packages: npm pack → publish (包)
 *
 * Uses `gh auth token` when GITHUB_TOKEN unset.
 * XRK_RELEASE_SKIP_UPLOAD=1     stage only
 * XRK_RELEASE_SKIP_GH_RELEASE=1 skip Release asset
 * XRK_RELEASE_SKIP_PACKAGES=1   skip npm publish
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = path.join(ROOT, ".release", "harness-cli");

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
    process.env.NODE_AUTH_TOKEN ||
    spawnSync("gh", ["auth", "token"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    }).stdout?.trim()
  );
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

const token = ghToken();
if (!token) {
  console.error("release: gh auth login (or GITHUB_TOKEN)");
  process.exit(1);
}

const ghEnv = { GH_TOKEN: token, GITHUB_TOKEN: token };

if (process.env.XRK_RELEASE_SKIP_GH_RELEASE !== "1") {
  const view = spawnSync("gh", ["release", "view", tag], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: ghEnv,
  });
  if (view.status === 0) {
    run("gh", ["release", "upload", tag, releaseTgz, "--clobber"], { env: ghEnv });
  } else {
    run(
      "gh",
      ["release", "create", tag, releaseTgz, "--title", tag, "--generate-notes"],
      { env: ghEnv },
    );
  }
}

if (process.env.XRK_RELEASE_SKIP_PACKAGES !== "1") {
  writeFileSync(
    path.join(STAGE, ".npmrc"),
    `@xrkseek:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${token}\n`,
  );

  const pack = spawnSync(
    "npx",
    ["--yes", "npm@10.9.2", "pack"],
    {
      cwd: STAGE,
      encoding: "utf8",
      shell: process.platform === "win32",
      env: { NODE_AUTH_TOKEN: token, GITHUB_TOKEN: token },
    },
  );
  if (pack.status !== 0) {
    process.stderr.write(pack.stderr || pack.stdout || "");
    process.exit(pack.status ?? 1);
  }
  const npmTgz = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!npmTgz) {
    console.error("release: npm pack produced no tarball");
    process.exit(1);
  }

  run(
    "npx",
    [
      "--yes",
      "npm@10.9.2",
      "publish",
      npmTgz,
      "--access",
      "public",
      "--registry",
      "https://npm.pkg.github.com",
    ],
    {
      cwd: STAGE,
      env: { NODE_AUTH_TOKEN: token, GITHUB_TOKEN: token },
    },
  );
}

console.log(`release: ${tag} done`);
