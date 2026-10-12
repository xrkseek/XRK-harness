import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasOurFreeModelEntry,
  isOurFreeModelPackage,
  tryApplyOurFreeModelHost,
} from "../src/dsh-compat/our-free-model-host.js";
import { resetHostApplyRegistry } from "../src/dsh-compat/host-apply-registry.js";

const temps: string[] = [];

afterEach(() => {
  resetHostApplyRegistry();
  delete (globalThis as { __ofmExpandModels?: boolean }).__ofmExpandModels;
  delete (globalThis as { __ofmTestEmit?: () => void }).__ofmTestEmit;
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("our-free-model-host", () => {
  it("detects package name and staged entry", () => {
    expect(isOurFreeModelPackage("dsh-our-free-model")).toBe(true);
    expect(isOurFreeModelPackage("other")).toBe(false);
    const root = mkdtempSync(path.join(tmpdir(), "ofm-entry-"));
    temps.push(root);
    expect(hasOurFreeModelEntry(root)).toBe(false);
    writeFileSync(path.join(root, "index.js"), "export function apply() {}");
    expect(hasOurFreeModelEntry(root)).toBe(true);
  });

  it("applies staged Cordis host half and syncs llm provider via forward", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "ofm-apply-"));
    const xrkHome = mkdtempSync(path.join(tmpdir(), "ofm-home-"));
    temps.push(pkgRoot, xrkHome);
    writeFileSync(
      path.join(pkgRoot, "index.js"),
      `export function apply(ctx) {
  ctx.llm.registerAdapter(["our-free-model"], {
    async listModels() {
      return [{
        id: "muse-spark",
        name: "Muse Spark",
        contextWindow: 128000,
        vision: true,
      }];
    },
    async resolveApiKey() { return "ofm-forward-key"; },
  });
  ctx.webServer.register({
    kind: "prefix",
    path: "/api/our-free-model",
    methods: ["GET"],
    handler: async (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    },
  });
}
`,
    );
    // Seed forward port the same way Host does after the real listener binds.
    mkdirSync(path.join(xrkHome, "our-free-model"), { recursive: true });
    writeFileSync(
      path.join(xrkHome, "our-free-model", "settings.json"),
      JSON.stringify({
        version: 1,
        enabled: true,
        forward: { enabled: true, host: "127.0.0.1", port: 18899 },
        forwardKey: "ofm-forward-key",
      }),
    );

    const syncCommunityLlmProvider = vi.fn(async () => undefined);
    const contribution = await tryApplyOurFreeModelHost(
      pkgRoot,
      "dsh-our-free-model",
      { syncCommunityLlmProvider, xrkHome },
    );

    expect(contribution?.meta.id).toBe("dsh-our-free-model-host");
    expect(contribution?.http?.length).toBe(1);
    await vi.waitFor(() => {
      expect(syncCommunityLlmProvider).toHaveBeenCalled();
    });
    expect(syncCommunityLlmProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "our-free-model",
        displayName: "Our Free Model",
        baseUrl: "http://127.0.0.1:18899/v1",
        apiKey: "ofm-forward-key",
        models: [
          expect.objectContaining({
            id: "muse-spark",
            name: "Muse Spark",
            contextWindow: 128000,
            inputModalities: ["text", "image"],
          }),
        ],
      }),
    );
  });

  it("keeps Face sync baseUrl when forward settings briefly lose the port", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "ofm-cache-"));
    const xrkHome = mkdtempSync(path.join(tmpdir(), "ofm-home-cache-"));
    temps.push(pkgRoot, xrkHome);
    writeFileSync(
      path.join(pkgRoot, "index.js"),
      `export function apply(ctx) {
  const adapter = {
    async listModels() {
      if (globalThis.__ofmExpandModels) {
        return [
          { id: "m1", name: "M1", contextWindow: 8000 },
          { id: "m2", name: "M2", contextWindow: 8000 },
        ];
      }
      return [{ id: "m1", name: "M1", contextWindow: 8000 }];
    },
  };
  ctx.llm.registerAdapter(["our-free-model"], adapter);
  globalThis.__ofmTestEmit = () => ctx.emit("llm/adapters-updated");
}
`,
    );
    mkdirSync(path.join(xrkHome, "our-free-model"), { recursive: true });
    const settingsPath = path.join(xrkHome, "our-free-model", "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 1,
        enabled: true,
        forward: { enabled: true, host: "127.0.0.1", port: 19991 },
        forwardKey: "k1",
      }),
    );

    const syncCommunityLlmProvider = vi.fn(async () => undefined);
    await tryApplyOurFreeModelHost(pkgRoot, "dsh-our-free-model", {
      syncCommunityLlmProvider,
      xrkHome,
    });
    await vi.waitFor(() => {
      expect(syncCommunityLlmProvider).toHaveBeenCalled();
    });
    expect(syncCommunityLlmProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        baseUrl: "http://127.0.0.1:19991/v1",
      }),
    );

    // Simulate forward rebind writing port:0 before the bound port is persisted.
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 1,
        enabled: true,
        forward: { enabled: true, host: "127.0.0.1", port: 0 },
      }),
    );
    const before = syncCommunityLlmProvider.mock.calls.length;
    (
      globalThis as { __ofmExpandModels?: boolean; __ofmTestEmit?: () => void }
    ).__ofmExpandModels = true;
    (
      globalThis as { __ofmTestEmit?: () => void }
    ).__ofmTestEmit?.();
    await vi.waitFor(() => {
      expect(syncCommunityLlmProvider.mock.calls.length).toBeGreaterThan(before);
    });
    const last =
      syncCommunityLlmProvider.mock.calls[
        syncCommunityLlmProvider.mock.calls.length - 1
      ]?.[0];
    expect(last).toEqual(
      expect.objectContaining({
        providerId: "our-free-model",
        baseUrl: "http://127.0.0.1:19991/v1",
        models: expect.arrayContaining([
          expect.objectContaining({ id: "m2" }),
        ]),
      }),
    );
  });

  it("exposes connection.admit so OFM trust fence does not 503", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "ofm-admit-"));
    temps.push(pkgRoot);
    writeFileSync(
      path.join(pkgRoot, "index.js"),
      `export function apply(ctx) {
  const connection = ctx.connection ?? ctx.get("connection");
  if (typeof connection?.admit !== "function") {
    throw new Error("connection.admit missing");
  }
  // Same unwrap as OFM src/trust.js rejectionFor.
  const admission = connection.admit({});
  const status =
    admission && typeof admission === "object" ? admission.rejection : undefined;
  if (status !== undefined) throw new Error("admit unexpectedly rejected");
  ctx.webServer.register({
    kind: "prefix",
    path: "/api/our-free-model",
    methods: ["GET"],
    handler: async (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, admission: "pass" }));
    },
  });
}
`,
    );
    const contribution = await tryApplyOurFreeModelHost(
      pkgRoot,
      "dsh-our-free-model",
      {},
    );
    expect(contribution?.http?.length).toBe(1);
  });

  it("bridges connection.fetch.register onto HTTP contribution", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "ofm-fetch-"));
    temps.push(pkgRoot);
    writeFileSync(
      path.join(pkgRoot, "index.js"),
      `export function apply(ctx) {
  const connection = ctx.connection ?? ctx.get("connection");
  connection.fetch.register({
    path: "/api/channel-pack",
    methods: ["POST"],
    async fetch(request) {
      const msg = await request.json();
      return Response.json({
        type: "server-response",
        rpcId: msg.rpcId,
        result: { ok: true, value: { method: msg.payload?.method } },
      });
    },
  });
}
`,
    );

    const contribution = await tryApplyOurFreeModelHost(
      pkgRoot,
      "dsh-our-free-model",
      {},
    );
    expect(contribution?.meta.httpPrefixes).toContain("/api/channel-pack");
    expect(contribution?.http?.length).toBe(1);
    const row = contribution!.http![0]!;
    expect(row.match("/api/channel-pack")).toBe(true);
    expect(row.match("/api/channel-pack/captcha-carrier")).toBe(false);

    const { createServer } = await import("node:http");
    const body = JSON.stringify({
      type: "client-request",
      rpcId: "t1",
      method: "channel-pack",
      payload: { method: "provider.status", payload: { providers: ["codearts"] } },
    });
    await new Promise<void>((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const handled = await row.handle(req, res, "/api/channel-pack");
          expect(handled).toBe(true);
        } catch (err) {
          reject(err);
        }
      });
      server.listen(0, "127.0.0.1", async () => {
        try {
          const addr = server.address();
          if (!addr || typeof addr === "string") throw new Error("no-port");
          const response = await fetch(
            `http://127.0.0.1:${addr.port}/api/channel-pack`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
            },
          );
          expect(response.status).toBe(200);
          const json = (await response.json()) as {
            rpcId: string;
            result: { ok: boolean; value: { method: string } };
          };
          expect(json.rpcId).toBe("t1");
          expect(json.result).toEqual({
            ok: true,
            value: { method: "provider.status" },
          });
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });
  });

  it("returns undefined for non-ofm packages", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "ofm-skip-"));
    temps.push(pkgRoot);
    writeFileSync(path.join(pkgRoot, "index.js"), "export function apply() {}");
    expect(
      await tryApplyOurFreeModelHost(pkgRoot, "dsh-something-else", {}),
    ).toBeUndefined();
  });
});
