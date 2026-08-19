/**
 * Regenerate packages/client/<name>/lib/types from each package tsconfig.
 * Prefer tsconfig.client.json; also emit tsconfig.host.json when present.
 * Clears tsbuildinfo so stale @deepseek-ai declaration rewrites do not stick.
 *
 *   node ./scripts/emit-client-types-all.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = path.join(ROOT, "packages", "client");
const OMIT = new Set(["hmr"]);

function tscCli() {
  const cli = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(cli)) throw new Error("typescript tsc not found");
  return cli;
}

function configsFor(dir) {
  const out = [];
  const client = path.join(dir, "tsconfig.client.json");
  const host = path.join(dir, "tsconfig.host.json");
  const plain = path.join(dir, "tsconfig.json");
  if (existsSync(client)) out.push(client);
  if (existsSync(host)) out.push(host);
  if (out.length === 0 && existsSync(plain)) {
    // Skip solution-style roots that only hold project references.
    try {
      const raw = JSON.parse(readFileSync(plain, "utf8"));
      if (Array.isArray(raw.files) && raw.files.length === 0 && raw.references) {
        return out;
      }
    } catch {
      /* fall through */
    }
    out.push(plain);
  }
  return out;
}

function clearBuildInfo(dir) {
  const lib = path.join(dir, "lib");
  if (!existsSync(lib)) return;
  for (const ent of readdirSync(lib)) {
    if (ent.endsWith(".tsbuildinfo")) {
      unlinkSync(path.join(lib, ent));
    }
  }
}

function main() {
  const tsc = tscCli();
  const failed = [];
  for (const ent of readdirSync(CLIENT_SRC, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (OMIT.has(ent.name)) continue;
    const dir = path.join(CLIENT_SRC, ent.name);
    const configs = configsFor(dir);
    if (configs.length === 0) continue;
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    clearBuildInfo(dir);
    for (const tsconfig of configs) {
      const label = path.basename(tsconfig);
      process.stdout.write(`types ${pkg.name ?? ent.name} (${label})\n`);
      const result = spawnSync(process.execPath, [tsc, "-p", tsconfig], {
        cwd: ROOT,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        process.stderr.write(
          `  warn ${pkg.name}: ${label} tsc ${result.status}\n`,
        );
        failed.push(`${pkg.name ?? ent.name}:${label}`);
      }
    }
  }
  if (failed.length) {
    process.stderr.write(
      `emit-client-types-all: ${failed.length} config(s) had tsc errors (emit may still be useful)\n`,
    );
  }
}

main();
