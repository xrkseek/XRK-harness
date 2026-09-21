import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPolicyEngine } from "@xrkseek/policy";
import { createCordisCompatRegistry } from "../src/dsh-compat/cordis-registry.js";
import { handleOfficeRpc } from "../src/dsh-compat/im-office.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("office.connect Host policy", () => {
  it("status is ungated; configure denies under default policy", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-office-home-"));
    temps.push(home);
    const policy = createPolicyEngine();

    const status = await handleOfficeRpc("connection.status", {}, {
      xrkHome: home,
      policy,
    });
    expect((status as { configured: boolean }).configured).toBe(false);

    await expect(
      handleOfficeRpc(
        "configure",
        { baseUrl: "https://office.example", deviceId: "dev-1" },
        { xrkHome: home, policy },
      ),
    ).rejects.toMatchObject({
      name: "HostPolicyError",
      code: "policy-denied",
      details: {
        kind: "office.connect",
        reason: expect.any(String),
      },
    });

    await expect(
      handleOfficeRpc("reconnect", {}, { xrkHome: home, policy }),
    ).rejects.toMatchObject({
      code: "policy-denied",
      details: { kind: "office.connect" },
    });
    await expect(
      handleOfficeRpc("test", {}, { xrkHome: home, policy }),
    ).rejects.toMatchObject({ code: "policy-denied" });
    await expect(
      handleOfficeRpc("remove", {}, { xrkHome: home, policy }),
    ).rejects.toMatchObject({ code: "policy-denied" });
  });

  it("configure denies when policy omitted (product default engine)", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-office-home-"));
    temps.push(home);
    await expect(
      handleOfficeRpc(
        "configure",
        { baseUrl: "https://office.example", deviceId: "dev-1" },
        { xrkHome: home },
      ),
    ).rejects.toMatchObject({
      name: "HostPolicyError",
      code: "policy-denied",
    });
  });

  it("ask without seam → policy-ask; seam allow configures", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-office-ask-"));
    temps.push(home);
    const policy = createPolicyEngine({
      defaults: { "office.connect": "ask" },
    });

    await expect(
      handleOfficeRpc(
        "configure",
        { baseUrl: "https://office.example", deviceId: "dev-ask" },
        { xrkHome: home, policy },
      ),
    ).rejects.toMatchObject({
      code: "policy-ask",
      details: { kind: "office.connect", reason: expect.any(String) },
    });

    await expect(
      handleOfficeRpc(
        "configure",
        { baseUrl: "https://office.example", deviceId: "dev-ask" },
        {
          xrkHome: home,
          policy,
          resolvePolicyAsk: async () => false,
        },
      ),
    ).rejects.toMatchObject({
      code: "policy-denied",
      details: { kind: "office.connect" },
    });

    const configured = await handleOfficeRpc(
      "configure",
      {
        baseUrl: "https://office.example",
        deviceId: "dev-ask",
        sessionId: "sess-office",
      },
      {
        xrkHome: home,
        policy,
        resolvePolicyAsk: async () => true,
      },
    );
    expect((configured as { configured: boolean }).configured).toBe(true);
  });

  it("cordis maps HostPolicyError to rpcErr (not nested rpcOk)", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-office-rpc-"));
    temps.push(home);
    const reg = createCordisCompatRegistry();
    reg.registerRpc("/office", async (endpoint, payload) =>
      handleOfficeRpc(endpoint, payload, {
        xrkHome: home,
        policy: createPolicyEngine(),
      }),
    );
    const server = createServer((req, res) => {
      void reg.handle(
        req,
        res,
        new URL(req.url ?? "/", "http://127.0.0.1").pathname,
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/office/configure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "o-deny",
          method: "configure",
          payload: { baseUrl: "https://x.example", deviceId: "d1" },
        }),
      });
      const body = (await res.json()) as {
        result: { ok: boolean; error?: { code: string }; value?: unknown };
      };
      expect(body.result.ok).toBe(false);
      expect(body.result.error?.code).toBe("policy-denied");
      expect(body.result.error).toMatchObject({
        details: { kind: "office.connect" },
      });
      expect(body.result.value).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
