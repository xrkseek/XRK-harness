#!/usr/bin/env node
/**
 * Local npm pack smoke — verifies tarballs before any publish cut.
 * Does not flip "private" or publish to registry.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ name: string; dir: string; tarballPrefix: string }[]} */
const PACKAGES = [
  { name: "@xrkseek/harness", dir: "packages/sdk", tarballPrefix: "xrkseek-harness-" },
  { name: "@xrkseek/harness-cli", dir: "apps/cli", tarballPrefix: "xrkseek-harness-cli-" },
  { name: "@xrkseek/mcp", dir: "packages/mcp", tarballPrefix: "xrkseek-mcp-" },
  { name: "@xrkseek/web-frontend", dir: "apps/web", tarballPrefix: "xrkseek-web-frontend-" },
];

const FORBIDDEN = [
  /^\.env/i,
  /credentials\.json$/i,
  /host-settings\.json$/i,
  /\.pem$/i,
];

function run(cmd, args, cwd = ROOT) {
  // Windows: .cmd shims need shell; args here are fixed literals only.
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function listTarEntries(tgzPath) {
  const r = spawnSync("tar", ["-tzf", tgzPath], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    throw new Error(`tar -tzf failed for ${tgzPath}: ${r.stderr ?? r.stdout}`);
  }
  return r.stdout.trim().split("\n").filter(Boolean);
}

async function newestMatchingTgz(dir, prefix) {
  const names = await readdir(dir);
  const matches = names.filter((n) => n.startsWith(prefix) && n.endsWith(".tgz"));
  if (matches.length === 0) return null;
  let best = matches[0];
  let bestMtime = 0;
  for (const n of matches) {
    const s = await stat(join(dir, n));
    if (s.mtimeMs >= bestMtime) {
      bestMtime = s.mtimeMs;
      best = n;
    }
  }
  return join(dir, best);
}

async function main() {
  console.log("pack-smoke: building…");
  run("pnpm", ["exec", "tsc", "-b", "--pretty", "false"]);

  const outDir = await mkdtemp(join(tmpdir(), "xrk-pack-smoke-"));

  try {
    for (const pkg of PACKAGES) {
      console.log(`\npack-smoke: packing ${pkg.name}…`);
      const pkgDir = join(ROOT, pkg.dir);
      run("pnpm", ["pack", "--pack-destination", outDir], pkgDir);

      const tgz = await newestMatchingTgz(outDir, pkg.tarballPrefix);
      if (!tgz) {
        console.error(`pack-smoke: no .tgz for ${pkg.name} in ${outDir}`);
        process.exit(1);
      }

      const entries = listTarEntries(tgz);
      const bad = entries.filter((e) => FORBIDDEN.some((re) => re.test(e)));
      if (bad.length > 0) {
        console.error(`pack-smoke: ${pkg.name} forbidden paths:\n  ${bad.join("\n  ")}`);
        process.exit(1);
      }
      const hasDist = entries.some((e) => e.includes("/dist/") || e.endsWith("/dist"));
      if (!hasDist) {
        console.error(`pack-smoke: ${pkg.name} missing dist/`);
        process.exit(1);
      }
      console.log(`pack-smoke: OK ${pkg.name} (${entries.length} entries)`);
    }

    console.log("\npack-smoke: all sampled packages passed.");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
