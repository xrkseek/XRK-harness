#!/usr/bin/env node
/**
 * Desktop Face transport regression lane (loopback Host · protocol · client).
 *
 *   node apps/desktop/scripts/test-face-transport.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const suites = [
  "apps/desktop/tests/host-process.test.ts",
  "apps/desktop/tests/protocol.test.ts",
  "apps/desktop/tests/desktop-host-attach.test.ts",
  "packages/server/http/tests/fetch-dispatch.test.ts",
  "packages/client/connection/tests/web-api-desktop.test.ts",
];

// Invoke vitest by path so pnpm does not re-enter install / --prod checks
// (those can prune the workspace after `pnpm deploy --prod` for host-bundle).
const vitestEntry = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitestEntry, "run", "--reporter=verbose", ...suites],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
