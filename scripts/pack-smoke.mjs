#!/usr/bin/env node
/**
 * Local npm pack smoke — verifies tarballs before any publish cut.
 * Does not flip "private" or publish to registry.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGES = [
  "@xrkseek/harness",
  "@xrkseek/harness-cli",
  "@xrkseek/mcp",
];

const FORBIDDEN = [
  /^\.env/i,
  /credentials\.json$/i,
  /host-settings\.json$/i,
  /\.pem$/i,
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function listTarEntries(tgzPath) {
  const r = spawnSync("tar", ["-tzf", tgzPath], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`tar -tzf failed for ${tgzPath}: ${r.stderr ?? r.stdout}`);
  }
  return r.stdout.trim().split("\n").filter(Boolean);
}

async function newestTgz(dir, prefix) {
  const names = await readdir(dir);
  const matches = names.filter((n) => n.startsWith(prefix) && n.endsWith(".tgz"));
  if (matches.length === 0) {
    return null;
  }
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
    for (const name of PACKAGES) {
      console.log(`\npack-smoke: packing ${name}…`);
      const r = spawnSync(
        "pnpm",
        ["--filter", name, "pack", "--pack-destination", outDir],
        { encoding: "utf8", shell: true },
      );
      if (r.status !== 0) {
        console.error(r.stderr ?? r.stdout);
        process.exit(1);
      }

      const short = name.replace("@xrkseek/", "xrkseek-");
      const tgz = await newestTgz(outDir, short);
      if (!tgz) {
        console.error(`pack-smoke: no .tgz found for ${name} in ${outDir}`);
        process.exit(1);
      }

      const entries = listTarEntries(tgz);
      const bad = entries.filter((e) => FORBIDDEN.some((re) => re.test(e)));
      if (bad.length > 0) {
        console.error(`pack-smoke: ${name} tarball contains forbidden paths:\n  ${bad.join("\n  ")}`);
        process.exit(1);
      }
      const hasDist = entries.some((e) => e.includes("/dist/") || e.endsWith("/dist"));
      if (!hasDist) {
        console.error(`pack-smoke: ${name} tarball missing dist/ — run build first`);
        process.exit(1);
      }
      console.log(`pack-smoke: OK ${name} (${entries.length} entries)`);
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
