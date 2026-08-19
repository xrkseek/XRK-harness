/**
 * Emit packages/stubs/<name>/lib/types via tsc (input for client:types).
 *
 *   pnpm stub:types
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STUBS = path.join(ROOT, "packages", "stubs");

function tscCli() {
  const cli = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(cli)) throw new Error("typescript tsc not found");
  return cli;
}

function main() {
  const tsc = tscCli();
  const names = readdirSync(STUBS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const failed = [];
  for (const name of names) {
    const tsconfig = path.join(STUBS, name, "tsconfig.json");
    if (!existsSync(tsconfig)) continue;
    process.stdout.write(`stub-types ${name}\n`);
    const result = spawnSync(process.execPath, [tsc, "-p", tsconfig], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (result.status !== 0) failed.push(name);
  }
  if (failed.length) {
    throw new Error(`stub:types failed (${failed.length}): ${failed.join(", ")}`);
  }
}

main();
