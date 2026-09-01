#!/usr/bin/env node
/**
 * Withdraw redundant @xrkseek/harness-cli versions on npmjs.
 * Keeps formal latest (apps/cli version) and preview (0.0.11). Tries unpublish first, then deprecate.
 *
 * Auth: NPM_TOKEN or npm login. Write actions may need NPM_CONFIG_OTP (6-digit TOTP or one 64-char recovery code).
 *
 *   node scripts/npm-prune-withdrawn.mjs
 *   node scripts/npm-prune-withdrawn.mjs --deprecate-only
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPkg = JSON.parse(
  readFileSync(path.join(ROOT, "apps/cli/package.json"), "utf8").replace(/^\uFEFF/, ""),
);
const formal = typeof cliPkg.version === "string" ? cliPkg.version : "0.1.23";

const PKG = "@xrkseek/harness-cli";
const KEEP = new Set(["0.0.11", formal]);
const REGISTRY = "https://registry.npmjs.org";
const DEPRECATE_MSG =
  `Withdrawn. Use @xrkseek/harness-cli@${formal} (formal) or @0.0.11 (preview).`;

const deprecateOnly = process.argv.includes("--deprecate-only");

/** Prefer node npm-cli.js so empty-string args survive Windows (npm.cmd drops them). */
function npm(args) {
  const otp = (process.env.NPM_CONFIG_OTP ?? process.env.NPM_OTP ?? "").trim();
  const full = [...args, "--registry", REGISTRY];
  if (otp) full.push("--otp", otp);
  const npmCli = path.join(
    process.env.ProgramFiles ?? "C:\\Program Files",
    "nodejs",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const r = spawnSync(process.execPath, [npmCli, ...full], {
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

const list = npm(["view", PKG, "versions", "--json"]);
if (list.status !== 0) {
  console.error(list.out || "npm view failed");
  process.exit(1);
}
let versions;
try {
  versions = JSON.parse(list.out);
} catch {
  console.error("unexpected npm view output");
  process.exit(1);
}

const withdrawn = versions.filter((v) => !KEEP.has(v));
if (withdrawn.length === 0) {
  console.log("npm-prune: nothing to withdraw");
  process.exit(0);
}

console.log(`npm-prune: withdrawing ${withdrawn.length} version(s): ${withdrawn.join(", ")}`);

for (const ver of withdrawn) {
  if (!deprecateOnly) {
    const un = npm(["unpublish", `${PKG}@${ver}`, "--force"]);
    if (un.status === 0) {
      console.log(`  unpublish ${ver} ok`);
      continue;
    }
    if (un.out.includes("403") || un.out.includes("Granular")) {
      console.warn(`  unpublish ${ver} blocked (token/unpublish policy) — deprecating`);
    } else {
      console.warn(`  unpublish ${ver} failed — deprecating (${un.out.slice(0, 120)})`);
    }
  }
  const dep = npm(["deprecate", `${PKG}@${ver}`, DEPRECATE_MSG]);
  if (dep.status === 0) {
    console.log(`  deprecate ${ver} ok`);
  } else {
    console.error(`  deprecate ${ver} failed: ${dep.out.slice(0, 200)}`);
  }
}

// Clear accidental deprecate banners on kept lines (empty message = undeprecate).
for (const ver of KEEP) {
  const clear = npm(["deprecate", `${PKG}@${ver}`, ""]);
  if (clear.status === 0) {
    console.log(`  undeprecate kept ${ver} ok`);
  } else if (clear.out) {
    console.warn(`  undeprecate ${ver}: ${clear.out.slice(0, 160)}`);
  }
}

const tags = npm(["dist-tag", "ls", PKG]);
console.log(tags.out || "dist-tag ls done");
