import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  isCordisBridgedForInvoke,
  resolveCordisFiberState,
} from "../src/cordis-bridge.js";
import { listFacePluginInventory } from "../src/plugin-inventory.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stageClient(pluginsDir: string, packageName: string, code = "export {}") {
  const root = path.join(pluginsDir, "web", "plugins", ...packageName.split("/"));
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "client.js"), code);
}

describe("cordis dsh-compat bridge", () => {
  it("marks cordis active when host.mjs apply succeeded", () => {
    const runtime = createBareFaceRuntime({
      plugins: [{ id: "dsh/demo", kind: "cordis" }],
      hostPublic: {
        host: "127.0.0.1",
        port: 8787,
        workspaceRoot: "/tmp",
        preset: "harness",
        corsOrigin: "*",
        rateLimitPerMinute: 60,
        webDistConfigured: true,
        cordisHostApplied: ["dsh/demo"],
      },
    });
    expect(resolveCordisFiberState(runtime, "dsh/demo")).toEqual({
      enabled: true,
      fiberPhase: "active",
    });
    expect(listFacePluginInventory(runtime)[0]?.fiberPhase).toBe("active");
  });

  it("marks cordis active when staged client.js exists", () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-cordis-stage-"));
    temps.push(pluginsDir);
    stageClient(pluginsDir, "community/pkg");
    const runtime = createBareFaceRuntime({
      plugins: [{ id: "community/pkg", kind: "cordis" }],
      hostPublic: {
        host: "127.0.0.1",
        port: 8787,
        workspaceRoot: "/tmp",
        preset: "harness",
        corsOrigin: "*",
        rateLimitPerMinute: 60,
        webDistConfigured: true,
        pluginsDir,
      },
    });
    expect(isCordisBridgedForInvoke(runtime, "community/pkg", "community/pkg")).toBe(
      true,
    );
  });

  it("dynamicCordisRunner/invoke succeeds for bridged cordis", async () => {
    const runtime = createBareFaceRuntime({
      plugins: [{ id: "@cordis/foo", kind: "cordis" }],
      hostPublic: {
        host: "127.0.0.1",
        port: 8787,
        workspaceRoot: "/tmp",
        preset: "harness",
        corsOrigin: "*",
        rateLimitPerMinute: 60,
        webDistConfigured: true,
        cordisHostApplied: ["@cordis/foo"],
      },
    });
    const res = await dispatchFaceMethod(
      runtime,
      "dynamicCordisRunner/invoke",
      "rpc1",
      { args: ["", "@cordis/foo"] },
    );
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("invoke");
    expect(res.result.value).toMatchObject({
      ok: true,
      hostBridge: true,
      hostApplied: true,
    });
  });

  it("dynamicCordisRunner/invoke forwards RPC via cordisHostBridge", async () => {
    const runtime = createBareFaceRuntime({
      plugins: [{ id: "rpc/pkg", kind: "cordis" }],
      hostPublic: {
        host: "127.0.0.1",
        port: 8787,
        workspaceRoot: "/tmp",
        preset: "harness",
        corsOrigin: "*",
        rateLimitPerMinute: 60,
        webDistConfigured: true,
        cordisHostApplied: ["rpc/pkg"],
        cordisHostPackages: [
          { packageName: "rpc/pkg", rpcChannels: ["/rpc/pkg"] },
        ],
      },
      cordisHostBridge: {
        invokeRpc: async (channel, endpoint, payload) => ({
          channel,
          endpoint,
          payload,
        }),
      },
    });
    const res = await dispatchFaceMethod(
      runtime,
      "dynamicCordisRunner/invoke",
      "rpc-fwd",
      {
        args: {
          pluginId: "rpc/pkg",
          packageId: "rpc/pkg",
          channel: "/rpc/pkg",
          method: "status",
          payload: { ready: true },
        },
      },
    );
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("invoke");
    expect(res.result.value).toMatchObject({
      ok: true,
      rpcForwarded: true,
      channel: "/rpc/pkg",
      endpoint: "status",
      value: {
        channel: "/rpc/pkg",
        endpoint: "status",
        payload: { ready: true },
      },
    });
  });

  it("runHostHalf uses cordisHostBridge and updates cordisHostApplied", async () => {
    const runtime = createBareFaceRuntime({
      hostPublic: {
        host: "127.0.0.1",
        port: 8787,
        workspaceRoot: "/tmp",
        preset: "harness",
        corsOrigin: "*",
        rateLimitPerMinute: 60,
        webDistConfigured: true,
        cordisHostApplied: [],
      },
      cordisHostBridge: {
        applyHostHalf: async (name) => {
          (
            runtime.hostPublic as { cordisHostApplied?: string[] }
          ).cordisHostApplied = [name];
          return { ok: true };
        },
      },
    });
    const res = await dispatchFaceMethod(
      runtime,
      "dynamicCordisRunner/runHostHalf",
      "rpc2",
      { args: { packageId: "pkg/apply-me" } },
    );
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("runHostHalf");
    expect(res.result.value).toMatchObject({ ok: true, hostBridge: true });
    expect(runtime.hostPublic?.cordisHostApplied).toEqual(["pkg/apply-me"]);
  });
});
