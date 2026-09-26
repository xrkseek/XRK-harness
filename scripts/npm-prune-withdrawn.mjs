#!/usr/bin/env node
/**
 * Withdraw redundant @xrkseek/harness-cli (and optional SDK) versions on npmjs.
 * Keep only: current CLI version (formal / @latest) + previous formal line 0.3.11.
 * Tries unpublish --force first, then deprecate. Clears leftover dist-tags
 * (`preview`, `rc`) that should not coexist with @latest alone.
 *
 * Auth: NPM_TOKEN or npm login. Write actions may need NPM_CONFIG_OTP.
 *
 *   node scripts/npm-prune-withdrawn.mjs
 *   node scripts/npm-prune-withdrawn.mjs --deprecate-only
 *   node scripts/npm-prune-withdrawn.mjs --also-sdk
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPkg = JSON.parse(
  readFileSync(path.join(ROOT, "apps/cli/package.json"), "utf8").replace(/^\uFEFF/, ""),
);
const formal = typeof cliPkg.version === "string" ? cliPkg.version : "0.4.12";

/** Previous formal-line pin kept on npmjs for rollback. */
const PREV_FORMAL = "0.3.11";
const KEEP = new Set([PREV_FORMAL, formal]);
const REGISTRY = "https://registry.npmjs.org";
const DEPRECATE_MSG = `Withdrawn.Use@xrkseek/harness-cli@${formal}(latest)or@${PREV_FORMAL}.`;

const deprecateOnly = process.argv.includes("--deprecate-only");
const alsoSdk = process.argv.includes("--also-sdk");

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

function prunePackage(pkg, keep, deprecateMsg) {
  const list = npm(["view", pkg, "versions", "--json"]);
  if (list.status !== 0) {
    console.error(`${pkg}: npm view failed`, list.out);
    return;
  }
  let versions;
  try {
    versions = JSON.parse(list.out);
  } catch {
    console.error(`${pkg}: unexpected npm view output`);
    return;
  }
  if (!Array.isArray(versions)) versions = [versions];

  const withdrawn = versions.filter((v) => !keep.has(v));
  if (withdrawn.length === 0) {
    console.log(`${pkg}: nothing to withdraw`);
  } else {
    console.log(`${pkg}: withdrawing ${withdrawn.length}: ${withdrawn.join(", ")}`);
  }

  for (const ver of withdrawn) {
    if (!deprecateOnly) {
      const un = npm(["unpublish", `${pkg}@${ver}`, "--force"]);
      if (un.status === 0) {
        console.log(`  unpublish ${ver} ok`);
        continue;
      }
      if (un.out.includes("403") || un.out.includes("Granular")) {
        console.warn(`  unpublish ${ver} blocked — deprecating`);
      } else {
        console.warn(`  unpublish ${ver} failed — deprecating (${un.out.slice(0, 120)})`);
      }
    }
    const dep = npm(["deprecate", `${pkg}@${ver}`, deprecateMsg]);
    if (dep.status === 0) {
      console.log(`  deprecate ${ver} ok`);
    } else {
      console.error(`  deprecate ${ver} failed: ${dep.out.slice(0, 200)}`);
    }
  }

  for (const ver of keep) {
    const clear = npm(["deprecate", `${pkg}@${ver}`, ""]);
    if (clear.status === 0) {
      console.log(`  undeprecate kept ${ver} ok`);
    } else if (clear.out) {
      console.warn(`  undeprecate ${ver}: ${clear.out.slice(0, 160)}`);
    }
  }

  const tags = npm(["dist-tag", "ls", pkg]);
  for (const tag of ["preview", "rc"]) {
    if (new RegExp(`\\b${tag}\\b`).test(tags.out || "")) {
      const rm = npm(["dist-tag", "rm", pkg, tag]);
      if (rm.status === 0) {
        console.log(`  dist-tag rm ${tag} ok`);
      } else {
        console.warn(`  dist-tag rm ${tag}: ${rm.out.slice(0, 160)}`);
      }
    }
  }
  const tagsAfter = npm(["dist-tag", "ls", pkg]);
  console.log(`${pkg} tags:\n${tagsAfter.out || "(none)"}`);
}

prunePackage("@xrkseek/harness-cli", KEEP, DEPRECATE_MSG);
if (alsoSdk) {
  prunePackage(
    "@xrkseek/harness",
    KEEP,
    `Withdrawn.Use@xrkseek/harness@${formal}(latest)or@${PREV_FORMAL}.`,
  );
}
