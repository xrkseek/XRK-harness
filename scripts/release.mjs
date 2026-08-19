#!/usr/bin/env node
/**
 * Release prep (does not npm publish — needs credentials).
 * 1. tsc -b
 * 2. apply publish surface (optional re-run)
 * 3. pack:smoke sample
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["exec", "tsc", "-b", "--pretty", "false"]);
run("node", [path.join(ROOT, "scripts", "pack-smoke.mjs")]);
process.stdout.write(
  "\nrelease: pack smoke OK.\nNext (manual): npm login → pnpm -r publish --access public --filter '!xrk-harness'\n" +
    "Or publish leaf set: @xrkseek/harness-cli @xrkseek/web-frontend @xrkseek/harness + deps.\n",
);
