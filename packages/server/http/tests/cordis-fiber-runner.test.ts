import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  invokeCordisFiberRpc,
  isCordisFiberRunning,
  listCordisFiberPackages,
  startCordisFiber,
  stopCordisFiber,
} from "../dist/dsh-compat/cordis-fiber-runner.js";
import { applyHostPackageByName } from "../dist/dsh-compat/host-apply-bridge.js";
import { resetHostApplyRegistry } from "../src/dsh-compat/host-apply-registry.js";
import { resetDshCompatRegistryCache } from "../src/dsh-compat/shared-registry.js";

const temps: string[] = [];

afterEach(async () => {
  resetDshCompatRegistryCache();
  resetHostApplyRegistry();
  for (const name of listCordisFiberPackages()) {
    await stopCordisFiber(name);
  }
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stageFiberHost(
  pluginsDir: string,
  packageName: string,
  hostBody: string,
): string {
  const pkgRoot = path.join(pluginsDir, "web", "plugins", ...packageName.split("/"));
  mkdirSync(pkgRoot, { recursive: true });
  writeFileSync(path.join(pkgRoot, "host.mjs"), hostBody);
  writeFileSync(
    path.join(pluginsDir, ".xrk-plugins.json"),
    JSON.stringify({
      rev: 1,
      packages: {
        [packageName]: { name: packageName, version: "1.0.0", kind: "client" },
      },
    }),
  );
  return pkgRoot;
}

describe("cordis-fiber-runner (C-5)", () => {
  it(
    "starts fiber worker and invokes registered RPC",
    async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-fiber-"));
    temps.push(pluginsDir);
    const pkgRoot = stageFiberHost(
      pluginsDir,
      "fiber-demo",
      `export async function apply(ctx) {
  if (!process.env.XRK_CORDIS_FIBER_WORKER) throw new Error('in-process-blocked');
  ctx.rpc.register('/fiber-demo', (endpoint, payload) => ({
    endpoint,
    ok: payload?.ping === true,
    via: 'fiber',
  }));
}`,
    );

    const started = await startCordisFiber({
      packageName: "fiber-demo",
      pkgRoot,
      pluginsDir,
    });
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true });
    expect(started.rpcChannels).toContain("/fiber-demo");
    expect(isCordisFiberRunning("fiber-demo")).toBe(true);

    const value = await invokeCordisFiberRpc(
      "fiber-demo",
      "/fiber-demo",
      "status",
      { ping: true },
    );
    expect(value).toMatchObject({
      endpoint: "status",
      ok: true,
      via: "fiber",
    });

    await stopCordisFiber("fiber-demo");
    expect(isCordisFiberRunning("fiber-demo")).toBe(false);
  },
    70_000,
  );

  it(
    "applyHostPackageByName falls back to fiber when in-process apply fails",
    async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-fiber-apply-"));
    temps.push(pluginsDir);
    const xrkHome = mkdtempSync(path.join(tmpdir(), "xrk-fiber-home-"));
    temps.push(xrkHome);
    stageFiberHost(
      pluginsDir,
      "fiber-only",
      `export async function apply(ctx) {
  if (!process.env.XRK_CORDIS_FIBER_WORKER) throw new Error('must-run-in-fiber');
  ctx.rpc.register('/fiber-only', (endpoint) => ({ endpoint, fiber: true }));
}`,
    );

    const ctx = { pluginsDir, xrkHome, workspaceRoot: pluginsDir };
    const ok = await applyHostPackageByName(ctx, "fiber-only");
    expect(ok).toBe(true);
    expect(isCordisFiberRunning("fiber-only")).toBe(true);

    const value = await invokeCordisFiberRpc(
      "fiber-only",
      "/fiber-only",
      "ping",
      {},
    );
    expect(value).toMatchObject({ endpoint: "ping", fiber: true });
  },
    70_000,
  );
});
