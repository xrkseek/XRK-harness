#!/usr/bin/env node
/**
 * Stage CLI, then upload GitHub Release + GitHub Packages.
 * Env: GITHUB_TOKEN (contents:write, packages:write). `gh` on PATH.
 * XRK_RELEASE_SKIP_UPLOAD=1 → stage only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

run("node", [path.join(ROOT, "scripts", "stage-cli-release.mjs")]);

if (!existsSync(path.join(STAGE, "product-web", "index.html"))) {
  console.error("release: stage incomplete");
  process.exit(1);
}

const pkg = JSON.parse(
  readFileSync(path.join(STAGE, "package.json"), "utf8").replace(/^\uFEFF/, ""),
);
const ver = pkg.version;
const releaseTgz = path.join(ROOT, ".release", `xrkseek-harness-cli-${ver}.tgz`);
if (!existsSync(releaseTgz)) {
  console.error(`release: missing ${releaseTgz}`);
  process.exit(1);
}

if (process.env.XRK_RELEASE_SKIP_UPLOAD === "1") {
  console.log(`release: staged v${ver} (upload skipped)`);
  process.exit(0);
}

const token =
  process.env.GITHUB_TOKEN ||
  process.env.NODE_AUTH_TOKEN ||
  spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).stdout?.trim();
if (!token) {
  console.error("release: no token (gh auth login, or set GITHUB_TOKEN)");
  process.exit(1);
}

const tag = `v${ver}`;
const assets = readdirSync(path.join(ROOT, ".release"))
  .filter((n) => n.endsWith(".tgz"))
  .map((n) => path.join(ROOT, ".release", n));

const view = spawnSync("gh", ["release", "view", tag], {
  cwd: ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
  env: process.env,
});
if (view.status === 0) {
  run("gh", ["release", "upload", tag, ...assets, "--clobber"], {
    env: { GH_TOKEN: token, GITHUB_TOKEN: token },
  });
} else {
  run(
    "gh",
    ["release", "create", tag, ...assets, "--title", tag, "--generate-notes"],
    { env: { GH_TOKEN: token, GITHUB_TOKEN: token } },
  );
}

run(
  "npm",
  ["publish", "--access", "public", "--registry", "https://npm.pkg.github.com"],
  {
    cwd: STAGE,
    env: { NODE_AUTH_TOKEN: token, GITHUB_TOKEN: token },
  },
);

console.log(`release: ${tag} → GitHub Release + Packages (@xrkseek/harness-cli@${ver})`);
