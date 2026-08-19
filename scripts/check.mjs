#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(major) || major < 26) {
  console.error(
    `xrk-harness requires Node.js >= 26 (current: ${process.versions.node}). See .nvmrc.`,
  );
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

/** Kernel + CLI paths mirrored by root tsconfig.json references (not product shell / DSH stubs). */
const LINT_PATHS = [
  "packages/kernel",
  "packages/compose",
  "packages/protocol",
  "packages/core",
  "packages/llm",
  "packages/mcp",
  "packages/attachment",
  "packages/exec",
  "packages/workspace",
  "packages/policy",
  "packages/code-runtime",
  "packages/testkit",
  "packages/server",
  "packages/web-runtime",
  "packages/sdk",
  "presets",
  "apps/cli/src",
];

run("npx", ["tsc", "-b", "--pretty", "false"]);
run("npx", [
  "eslint",
  ...LINT_PATHS,
  "--cache",
  "--cache-location",
  ".eslintcache",
]);
run("npx", ["vitest", "run"]);
run("npx", ["vitest", "run", "--config", "vitest.kernel.config.ts", "--coverage"]);
