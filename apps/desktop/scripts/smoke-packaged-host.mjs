#!/usr/bin/env node
/**
 * Packaged Desktop Host Face-pipe smoke (ADR-0008).
 *
 * Proves the failure modes that broke the installer UI:
 *   - unread mux + host SSE must not starve unary `host.describe`
 *   - both event buses open on `xrk-app://stream` (shell needs host for
 *     settings/document-updated and host/session-*)
 *   - cancelling SSE must not poison the next unary
 *
 * Usage:
 *   node apps/desktop/scripts/smoke-packaged-host.mjs \
 *     <hostDir> <xrkHome> [nodeExe] [webDist]
 *
 * hostDir = host-bundle/ or win-unpacked/resources/host/
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const hostDir = args[0] ? path.resolve(args[0]) : "";
const xrkHome = args[1] ? path.resolve(args[1]) : "";
const nodeExe = path.resolve(
  args[2]?.trim() ||
    process.env.XRK_DESKTOP_HOST_NODE?.trim() ||
    process.execPath,
);
const webDist = path.resolve(
  args[3]?.trim() ||
    process.env.XRK_WEB_DIST?.trim() ||
    path.join(ROOT, "apps", "web", "dist"),
);

if (!hostDir || !xrkHome) {
  process.stderr.write(
    "usage: smoke-packaged-host.mjs <hostDir> <xrkHome> [nodeExe] [webDist]\n",
  );
  process.exit(2);
}

const entry = path.join(hostDir, "dist", "index.js");
if (!existsSync(entry)) {
  process.stderr.write(`smoke-packaged-host: missing ${entry}\n`);
  process.exit(1);
}
if (!existsSync(nodeExe)) {
  process.stderr.write(`smoke-packaged-host: missing node ${nodeExe}\n`);
  process.exit(1);
}
mkdirSync(xrkHome, { recursive: true });

const { DesktopHostProcess } = await import(
  pathToFileURL(path.join(ROOT, "apps/desktop/dist/host-process.js")).href
);

function fail(message) {
  process.stderr.write(`smoke-packaged-host: ${message}\n`);
  process.exit(1);
}

async function unary(host, method, payload = {}) {
  const response = await Promise.race([
    host.fetch(
      new Request(`xrk-app://app/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: `smoke-${method}`,
          method,
          payload,
        }),
      }),
    ),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
    }),
  ]);
  if (!response.ok) {
    fail(`${method} HTTP ${String(response.status)}`);
  }
  const body = await response.json();
  if (!body?.result?.ok) {
    fail(`${method} not ok: ${JSON.stringify(body?.result?.error ?? body)}`);
  }
  return body.result.value;
}

const host = new DesktopHostProcess(nodeExe, hostDir, {
  entry,
  env: {
    XRK_HOME: xrkHome,
    XRK_WEB_DIST: webDist,
  },
});

try {
  const ready = await host.start();
  process.stdout.write(
    `smoke-packaged-host: ready host=${ready.hostVersion} protocol=${String(ready.protocolVersion)}\n`,
  );

  const mux = await host.fetch(new Request("xrk-app://stream/api/events.mux"));
  if (!mux.ok || !(mux.headers.get("content-type") ?? "").includes("event-stream")) {
    fail(`mux SSE bad: HTTP ${String(mux.status)} ${mux.headers.get("content-type")}`);
  }
  process.stdout.write("smoke-packaged-host: mux SSE open (unread)\n");

  const hostBus = await host.fetch(new Request("xrk-app://stream/api/events.host"));
  if (
    !hostBus.ok ||
    !(hostBus.headers.get("content-type") ?? "").includes("event-stream")
  ) {
    fail(
      `host SSE bad: HTTP ${String(hostBus.status)} ${hostBus.headers.get("content-type")}`,
    );
  }
  process.stdout.write("smoke-packaged-host: host SSE open (unread)\n");

  const description = await unary(host, "host.describe");
  process.stdout.write(
    `smoke-packaged-host: describe while dual SSE ok version=${String(description?.version ?? "?")}\n`,
  );

  await mux.body?.cancel();
  await hostBus.body?.cancel();
  process.stdout.write("smoke-packaged-host: mux+host cancelled\n");

  await unary(host, "host.describe");
  process.stdout.write("smoke-packaged-host: describe after cancel ok\n");

  const sessions = await unary(host, "session.list");
  process.stdout.write(
    `smoke-packaged-host: session.list ok items=${String(sessions?.items?.length ?? 0)}\n`,
  );

  await Promise.race([
    host.stop(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("host.stop timed out")), 20_000);
    }),
  ]).catch(() => undefined);
  process.stdout.write("smoke-packaged-host: ok\n");
} catch (error) {
  process.stderr.write(
    `smoke-packaged-host: caught ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  await Promise.race([
    host.stop().catch(() => undefined),
    new Promise((resolve) => {
      setTimeout(resolve, 5_000);
    }),
  ]);
  fail(error instanceof Error ? error.message : String(error));
}
