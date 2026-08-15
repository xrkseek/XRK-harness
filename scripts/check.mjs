#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

run("npx", ["tsc", "-b", "--pretty", "false"]);
run("npx", ["eslint", "."]);
run("npx", ["vitest", "run"]);
run("npx", ["vitest", "run", "--config", "vitest.kernel.config.ts", "--coverage"]);
