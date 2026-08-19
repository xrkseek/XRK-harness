/**
 * Emit packages/client/<name>/lib/types via tsc (input for client:bundle).
 *
 * Uses each package's tsconfig.client.json when present, otherwise
 * tsconfig.json. Project references are not required: skipLibCheck plus
 * workspace package.json exports resolve @xrkseek/* .
 *
 *   pnpm client:types
 *   pnpm client:types connection runtime
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = path.join(ROOT, "packages", "client");
const OMIT = new Set([
  "@xrkseek/client-ui-cordis",
  "@xrkseek/xrk-cordis-client-runner",
  "@xrkseek/client-hmr",
]);

function readPkg(dir) {
  const pj = path.join(dir, "package.json");
  if (!existsSync(pj)) return null;
  return JSON.parse(readFileSync(pj, "utf8"));
}

function tscCli() {
  const cli = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(cli)) throw new Error("typescript tsc not found");
  return cli;
}

function configFor(dir) {
  const client = path.join(dir, "tsconfig.client.json");
  if (existsSync(client)) return client;
  return path.join(dir, "tsconfig.json");
}

function listTargets(filter) {
  const wanted = [];
  for (const ent of readdirSync(CLIENT_SRC, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(CLIENT_SRC, ent.name);
    const pkg = readPkg(dir);
    if (!pkg?.xrk?.client || typeof pkg.name !== "string") continue;
    if (OMIT.has(pkg.name)) continue;
    if (
      filter.length &&
      !filter.includes(ent.name) &&
      !filter.includes(pkg.name)
    ) {
      continue;
    }
    wanted.push({ name: ent.name, dir, pkg });
  }
  return wanted;
}

function main() {
  const filter = process.argv.slice(2);
  const targets = listTargets(filter);
  if (filter.length) {
    const found = new Set(targets.flatMap((t) => [t.name, t.pkg.name]));
    const missing = filter.filter((f) => !found.has(f));
    if (missing.length) {
      throw new Error(`unknown client package: ${missing.join(", ")}`);
    }
  }
  if (targets.length === 0) {
    throw new Error("no client packages to typecheck");
  }

  const tsc = tscCli();
  const failed = [];
  for (const { dir, pkg } of targets) {
    const tsconfig = configFor(dir);
    process.stdout.write(`types ${pkg.name}\n`);
    const result = spawnSync(process.execPath, [tsc, "-p", tsconfig], {
      cwd: ROOT,
      stdio: "inherit",
    });
    const entry = path.join(dir, "lib", "types", "client", "index.js");
    if (!existsSync(entry)) {
      process.stderr.write(`  missing ${path.relative(ROOT, entry)}\n`);
      failed.push(pkg.name);
      continue;
    }
    if (result.status !== 0) {
      process.stderr.write(
        `  warn ${pkg.name}: tsc ${result.status} (emit kept for client:bundle)\n`,
      );
    }
  }
  if (failed.length) {
    throw new Error(`client:types failed (${failed.length}): ${failed.join(", ")}`);
  }
}

main();
