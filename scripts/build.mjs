#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["tsc", "-b", "--pretty", "false"], {
  stdio: "inherit",
  shell: true,
});
if (r.status !== 0) process.exit(r.status ?? 1);

process.exit(0);
