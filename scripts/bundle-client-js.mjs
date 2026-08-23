/**
 * Emit packages/client/<name>/lib/client.js via tsdown (XRK_BUILD_FACE=client).
 * Also bundles Face wire shims under packages/stubs that declare xrk.client
 * (typert-registry / api-gateway / api-remotes) from src/client/index.ts.
 *
 * Requires each package's lib/types/client/index.js (tsc emit, or a copied
 * types tree). Does not build the Node half — that still needs the full
 * host-side @xrkseek graph.
 *
 *   pnpm client:bundle                  # every xrk.client plugin except OMIT
 *   pnpm client:bundle connection runtime
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = path.join(ROOT, "packages", "client");
const STUBS_SRC = path.join(ROOT, "packages", "stubs");
// Historical Cordis UI / runner ids (no longer in-tree) plus HMR —
// still filtered so overlays cannot reintroduce them.
const OMIT = new Set([
  "@xrkseek/client-ui-cordis",
  "@xrkseek/xrk-cordis-client-runner",
  "@xrkseek/client-hmr",
]);

function readPkg(dir) {
  const pj = path.join(dir, "package.json");
  if (!existsSync(pj)) return null;
  return JSON.parse(readFileSync(pj, "utf8").replace(/^\uFEFF/, ""));
}

/** Inline-safe stub imports must bundle, not become runtime require() leaks. */
const INLINE_SAFE_EXTERNAL = /require\(["']@xrkseek\/xrk-(?:host-apiproxy|session|llm|tools|brand)/;

function assertClientBundleInlined(pkgName, outPath) {
  const text = readFileSync(outPath, "utf8");
  const leak = INLINE_SAFE_EXTERNAL.exec(text);
  if (leak) {
    throw new Error(
      `${pkgName}: client.js externalized ${leak[0]} — rebuild after stub src resolve or run stub:types`,
    );
  }
}

function tsdownCli() {
  const candidates = [
    path.join(ROOT, "node_modules", "tsdown", "dist", "run.mjs"),
    path.join(ROOT, "node_modules", "tsdown", "dist", "cli.mjs"),
    path.join(ROOT, "node_modules", "tsdown", "dist", "cli.js"),
    path.join(ROOT, "node_modules", "tsdown", "bin.mjs"),
    path.join(ROOT, "node_modules", "tsdown", "bin.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("tsdown CLI not found — pnpm add -Dw tsdown lightningcss");
}

function listTargets(filter) {
  const dirs = [
    ...readdirSync(CLIENT_SRC, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, dir: path.join(CLIENT_SRC, d.name) })),
    ...readdirSync(STUBS_SRC, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, dir: path.join(STUBS_SRC, d.name) })),
  ];
  const wanted = [];
  for (const { name, dir } of dirs) {
    const pkg = readPkg(dir);
    if (!pkg?.xrk?.client || typeof pkg.name !== "string") continue;
    if (OMIT.has(pkg.name)) continue;
    if (filter.length && !filter.includes(name) && !filter.includes(pkg.name)) {
      continue;
    }
    wanted.push({ name, dir, pkg });
  }
  return wanted;
}

function main() {
  const filter = process.argv.slice(2);
  const targets = listTargets(filter);
  if (filter.length && targets.length !== filter.length) {
    const found = new Set(targets.flatMap((t) => [t.name, t.pkg.name]));
    const missing = filter.filter((f) => !found.has(f));
    if (missing.length) {
      throw new Error(`unknown client package: ${missing.join(", ")}`);
    }
  }
  if (targets.length === 0) {
    throw new Error("no client packages to bundle");
  }

  const cli = tsdownCli();
  const env = {
    ...process.env,
    XRK_CLIENT_JS_ONLY: "1",
  };
  let failed = 0;
  for (const { name, dir, pkg } of targets) {
    const typesEntry = path.join(dir, "lib", "types", "client", "index.js");
    const srcEntry = path.join(dir, "src", "client", "index.ts");
    if (!existsSync(typesEntry) && !existsSync(srcEntry)) {
      process.stderr.write(
        `skip ${pkg.name} (missing lib/types/client/index.js and src/client/index.ts)\n`,
      );
      failed += 1;
      continue;
    }
    process.stdout.write(`bundle ${pkg.name}\n`);
    const result = spawnSync(
      process.execPath,
      [cli, "--env.XRK_BUILD_FACE", "client"],
      { cwd: dir, env, stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(
        `tsdown failed for ${pkg.name} (exit ${result.status ?? "spawn"})`,
      );
    }
    const out = path.join(dir, "lib", "client.js");
    if (!existsSync(out)) {
      throw new Error(`tsdown did not emit ${path.relative(ROOT, out)}`);
    }
    assertClientBundleInlined(pkg.name, out);
    const srcStyles = path.join(dir, "src", "styles");
    const libStyles = path.join(dir, "lib", "styles");
    if (existsSync(srcStyles)) {
      cpSync(srcStyles, libStyles, { recursive: true });
    }
    process.stdout.write(`ok ${path.relative(ROOT, out)}\n`);
  }
  if (failed && filter.length) {
    throw new Error(`missing tsc emit for ${failed} package(s)`);
  }
}

main();
