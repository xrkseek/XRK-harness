import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  invokeDshCompatRpc,
  resetDshCompatRegistryCache,
  ensureDshCompatRegistry,
  appendDshCompatContribution,
} from "../src/dsh-compat/shared-registry.js";
import { resetHostApplyRegistry } from "../src/dsh-compat/host-apply-registry.js";
import { resetDshCompatUpgrades } from "../src/dsh-compat/dsh-compat-upgrades.js";
import { tryApplyHostModule, recordAppliedHostContribution } from "../src/dsh-compat/xrk-host-apply.js";

const temps: string[] = [];

afterEach(() => {
  resetDshCompatRegistryCache();
  resetHostApplyRegistry();
  resetDshCompatUpgrades();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("shared dsh-compat registry", () => {
  it("invokeDshCompatRpc forwards to host.mjs registered channel", async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-shared-reg-"));
    temps.push(pluginsDir);
    const pkgRoot = path.join(pluginsDir, "web", "plugins", "rpc-demo");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "host.mjs"),
      `export async function apply(ctx) {
  ctx.rpc.register("/rpc-demo", (endpoint, payload) => ({
    endpoint,
    echo: payload.msg,
    via: "apply",
  }));
}`,
    );
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "rpc-demo": { name: "rpc-demo", version: "1.0.0", kind: "client" },
        },
      }),
    );
    const ctx = { pluginsDir, xrkHome: mkdtempSync(path.join(tmpdir(), "xrk-home-")) };
    temps.push(ctx.xrkHome);
    const contribution = await tryApplyHostModule(pkgRoot, "rpc-demo", ctx);
    expect(contribution).toBeTruthy();
    recordAppliedHostContribution(contribution!);
    await appendDshCompatContribution(ctx, contribution!);
    const value = await invokeDshCompatRpc(ctx, "/rpc-demo", "ping", {
      msg: "hello",
    });
    expect(value).toMatchObject({
      endpoint: "ping",
      echo: "hello",
      via: "apply",
    });
    const registry = await ensureDshCompatRegistry(ctx);
    expect(registry.listRpcChannels()).toContain("/rpc-demo");
  });
});
