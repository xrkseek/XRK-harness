#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(major) || major < 26) {
  console.error(
    `xrk-harness requires Node.js >= 26 (current: ${process.versions.node}). See .nvmrc.`,
  );
  process.exit(1);
}

/** Keep forked Vitest workers on Node ≥26 while preserving Windows system tools. */
function childEnv() {
  const env = { ...process.env };
  if (process.platform !== "win32") return env;

  const systemNode = "C:\\Program Files\\nodejs";
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  const essentials = [
    systemNode,
    path.join(systemRoot, "System32"),
    path.join(systemRoot, "System32", "Wbem"),
    systemRoot,
  ];
  const segments = (env.PATH ?? "")
    .split(";")
    .filter(
      (segment) =>
        segment.length > 0 && !/cursor[\\/].*helpers/i.test(segment),
    );
  const seen = new Set(segments.map((segment) => segment.toLowerCase()));
  for (const dir of essentials) {
    if (!seen.has(dir.toLowerCase())) {
      segments.push(dir);
      seen.add(dir.toLowerCase());
    }
  }
  const rest = segments.filter(
    (segment) => segment.toLowerCase() !== systemNode.toLowerCase(),
  );
  env.PATH = [systemNode, ...rest].join(";");
  return env;
}

function runNode(entry, args) {
  const r = spawnSync(NODE, [entry, ...args], {
    stdio: "inherit",
    cwd: ROOT,
    env: childEnv(),
  });
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
  "packages/session",
  "packages/server",
  "packages/web-runtime",
  "packages/sdk",
  "presets",
  "apps/cli/src",
];

// Invoke repo-local CLIs through this script's Node (≥26), not `pnpm exec`
// (global pnpm on Windows may spawn IDE-bundled Node 22).
runNode(path.join(ROOT, "node_modules/typescript/bin/tsc"), [
  "-b",
  "--pretty",
  "false",
]);
runNode(path.join(ROOT, "node_modules/eslint/bin/eslint.js"), [
  ...LINT_PATHS,
  "--cache",
  "--cache-location",
  ".eslintcache",
]);
runNode(path.join(ROOT, "node_modules/vitest/vitest.mjs"), ["run"]);
runNode(path.join(ROOT, "node_modules/vitest/vitest.mjs"), [
  "run",
  "--config",
  "vitest.kernel.config.ts",
  "--coverage",
]);
