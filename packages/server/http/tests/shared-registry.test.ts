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
import { prewarmDshCompatAdapters } from "../src/dsh-compat/index.js";
import { createDshCompatPublicHandler } from "../src/dsh-compat/index.js";
import http from "node:http";
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

  it("prewarm with nested tokenLedger keeps aggregateUsage on tokenledger routes", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-tkl-prewarm-"));
    temps.push(home);
    const aggregateUsage = async () => ({
      ok: true,
      totals: { tokens: 42, requests: 3, cacheHitRate: 0, inputTokens: 30, outputTokens: 12 },
      windows: {
        today: { tokens: 42, inputTokens: 30, outputTokens: 12 },
        week: { tokens: 42, inputTokens: 30, outputTokens: 12 },
        month: { tokens: 42, inputTokens: 30, outputTokens: 12 },
      },
      activity: [],
      activityModels: [],
      sites: [],
      models: [],
      priced: { totals: {} },
    });
    const nestedCtx = {
      xrkHome: home,
      tokenLedger: { aggregateUsage },
    };
    await prewarmDshCompatAdapters(nestedCtx);
    const handler = createDshCompatPublicHandler(nestedCtx);
    const server = http.createServer(async (req, res) => {
      const ok = await handler(req, res);
      if (!ok) {
        res.statusCode = 404;
        res.end("404");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const usage = (await fetch(
      `http://127.0.0.1:${port}/api/tokenledger/usage`,
    ).then((r) => r.json())) as { totals: { tokens: number } };
    server.close();
    expect(usage.totals.tokens).toBe(42);
  });
});
