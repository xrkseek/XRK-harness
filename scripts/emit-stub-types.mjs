/**
 * Emit packages/stubs/<name>/lib/types via tsc (input for client:types),
 * then write package-root shims that package.json `main` / `exports["."]` expect.
 *
 * Stub tsconfigs use `outDir: lib/types`, but most package.json files still
 * point `main` / `exports["."].default` at `lib/index.js` (and `./invariant`
 * at `lib/invariant.js`). Without those shims, Node ESM resolution fails for
 * host-bundle / pnpm deploy (Desktop smoke: ERR_MODULE_NOT_FOUND).
 *
 * Client tsconfigs set `"types": []`, so stubs that import `node:*` need an
 * explicit `--types node` override. tsc still emits on type errors; warn and
 * keep going so later stubs / client:types can resolve already-written .d.ts.
 *
 *   pnpm stub:types
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STUBS = path.join(ROOT, "packages", "stubs");

function tscCli() {
  const cli = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(cli)) throw new Error("typescript tsc not found");
  return cli;
}

/** Write `lib/<name>.js` → `export * from "./types/<name>.js"` when types emit exists. */
function writePackageRootShims(stubDir) {
  const libDir = path.join(stubDir, "lib");
  const pairs = [
    ["index.js", "types/index.js"],
    ["invariant.js", "types/invariant.js"],
  ];
  for (const [shimName, typesRel] of pairs) {
    const typesFile = path.join(libDir, typesRel);
    if (!existsSync(typesFile)) continue;
    mkdirSync(libDir, { recursive: true });
    writeFileSync(
      path.join(libDir, shimName),
      `export * from "./${typesRel.replace(/\\/g, "/")}";\n`,
      "utf8",
    );
  }
}

function main() {
  const tsc = tscCli();
  const names = readdirSync(STUBS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const failed = [];
  for (const name of names) {
    const stubDir = path.join(STUBS, name);
    const tsconfig = path.join(stubDir, "tsconfig.json");
    if (!existsSync(tsconfig)) continue;
    process.stdout.write(`stub-types ${name}\n`);
    const result = spawnSync(
      process.execPath,
      [tsc, "-p", tsconfig, "--types", "node"],
      {
        cwd: ROOT,
        stdio: "inherit",
      },
    );
    const entry = path.join(stubDir, "lib", "types", "index.d.ts");
    const alt = path.join(stubDir, "lib", "types", "client", "index.d.ts");
    if (!existsSync(entry) && !existsSync(alt) && result.status !== 0) {
      process.stderr.write(`  missing types emit for ${name}\n`);
      failed.push(name);
      continue;
    }
    if (result.status !== 0) {
      process.stderr.write(
        `  warn ${name}: tsc ${result.status} (emit kept for client:types)\n`,
      );
    }
    writePackageRootShims(stubDir);
  }
  if (failed.length) {
    throw new Error(`stub:types failed (${failed.length}): ${failed.join(", ")}`);
  }
}

main();
