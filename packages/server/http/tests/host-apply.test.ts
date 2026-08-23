import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tryApplyHostModule, recordAppliedHostContribution } from "../src/dsh-compat/xrk-host-apply.js";
import {
  isHostApplied,
  listHostAppliedPackages,
  resetHostApplyRegistry,
} from "../src/dsh-compat/host-apply-registry.js";
import {
  listDshCompatUpgradePaths,
  resetDshCompatUpgrades,
} from "../src/dsh-compat/dsh-compat-upgrades.js";

const temps: string[] = [];

afterEach(() => {
  resetHostApplyRegistry();
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("xrk-host-apply", () => {
  it("loads createHostContribution from staged host.mjs", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "xrk-apply-unit-"));
    temps.push(pkgRoot);
    writeFileSync(
      path.join(pkgRoot, "host.mjs"),
      `export function createHostContribution() {
  return {
    http: [{
      match: (p) => p.startsWith("/my-native-tool/"),
      handle: async (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, via: "apply" }));
        return true;
      },
    }],
  };
}`,
    );
    const contribution = await tryApplyHostModule(pkgRoot, "my-native-tool", {});
    expect(contribution?.meta.id).toBe("my-native-tool-apply");
    expect(contribution?.http?.length).toBe(1);
    recordAppliedHostContribution(contribution!);
    expect(isHostApplied("my-native-tool")).toBe(true);
    expect(listHostAppliedPackages().map((r) => r.packageName)).toContain(
      "my-native-tool",
    );
  });

  it("loads apply() with webServer.register and rpc.register", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "xrk-apply-rpc-"));
    temps.push(pkgRoot);
    writeFileSync(
      path.join(pkgRoot, "host.mjs"),
      `export async function apply(ctx) {
  ctx.webServer.register({
    kind: "prefix",
    path: "/applied-rpc",
    handler: async (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, via: "http" }));
    },
  });
  ctx.rpc.register("/applied-rpc", (endpoint) => ({
    ok: true,
    endpoint,
    via: "rpc",
  }));
}`,
    );
    const contribution = await tryApplyHostModule(pkgRoot, "applied-rpc", {});
    expect(contribution?.meta.rpcChannels).toContain("/applied-rpc");
    expect(contribution?.http?.length).toBe(1);
  });

  it("registers upgrade routes via webServer.registerUpgrade", async () => {
    resetDshCompatUpgrades();
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "xrk-apply-ws-"));
    temps.push(pkgRoot);
    writeFileSync(
      path.join(pkgRoot, "host.mjs"),
      `export async function apply(ctx) {
  ctx.webServer.registerUpgrade({ path: "/ws/applied" });
}`,
    );
    await tryApplyHostModule(pkgRoot, "applied-ws", {});
    expect(listDshCompatUpgradePaths()).toContain("/ws/applied");
  });
});
