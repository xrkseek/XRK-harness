#!/usr/bin/env node
/**
 * Remove leftover vitest/mkdtemp dirs under os.tmpdir() named `xrk-*`,
 * plus `%TEMP%/.xrk` scratch from inject tests.
 *
 *   node ./scripts/clean-test-temp.mjs
 *   node ./scripts/clean-test-temp.mjs --dry-run
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(
    "clean-test-temp: remove os.tmpdir()/xrk-* leftovers from vitest\n",
  );
  process.exit(0);
}

const DRY = values["dry-run"] === true;
const root = tmpdir();
let removed = 0;
let failed = 0;

for (const name of readdirSync(root)) {
  if (!name.startsWith("xrk-") && name !== ".xrk") continue;
  const full = path.join(root, name);
  let st;
  try {
    st = statSync(full);
  } catch {
    continue;
  }
  if (!st.isDirectory() && name !== ".xrk") continue;
  if (DRY) {
    process.stdout.write(`dry-run: ${full}\n`);
    removed += 1;
    continue;
  }
  try {
    rmSync(full, { recursive: true, force: true });
    removed += 1;
  } catch {
    failed += 1;
  }
}

process.stdout.write(
  DRY
    ? `clean-test-temp: dry-run matched ${removed}\n`
    : `clean-test-temp: removed=${removed} failed=${failed} tmp=${root}\n`,
);
