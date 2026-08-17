#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["tsc", "-b", "--pretty", "false"], {
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);
