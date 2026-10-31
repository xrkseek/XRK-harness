import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureWorkBuddyAiElectronBin,
  enrichWorkBuddyStatusBody,
  hasWorkBuddyHostLib,
  isWorkBuddyConnectPackage,
  listModelsForSync,
  tryApplyWorkBuddyHost,
} from "../src/dsh-compat/workbuddy-host.js";
import {
  baseUrlFromCommunityModels,
  isUsableCommunityLoopbackBaseUrl,
} from "../src/dsh-compat/community-llm-host-sync.js";
import { resetHostApplyRegistry } from "../src/dsh-compat/host-apply-registry.js";
import { resetLiveHostApply } from "../src/dsh-compat/live-host-apply.js";

const temps: string[] = [];
const prevAiElectron = process.env.WORKBUDDY_AI_ELECTRON_BIN;

afterEach(() => {
  resetLiveHostApply();
  resetHostApplyRegistry();
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  if (prevAiElectron === undefined) delete process.env.WORKBUDDY_AI_ELECTRON_BIN;
  else process.env.WORKBUDDY_AI_ELECTRON_BIN = prevAiElectron;
});

describe("workbuddy-host", () => {
  it("hints WORKBUDDY_AI_ELECTRON_BIN for the WorkBuddyAI install layout", () => {
    const local = mkdtempSync(path.join(tmpdir(), "wb-ai-local-"));
    temps.push(local);
    const installRoot = path.join(local, "Programs", "WorkBuddyAI");
    mkdirSync(path.join(installRoot, "resources"), { recursive: true });
    writeFileSync(path.join(installRoot, "WorkBuddyAI.exe"), "");
    writeFileSync(path.join(installRoot, "version"), "37.2.0");
    writeFileSync(path.join(installRoot, "resources", "app.asar"), "");

    const env: NodeJS.ProcessEnv = { LOCALAPPDATA: local };
    expect(ensureWorkBuddyAiElectronBin(env, "win32")).toBe(
      path.join(installRoot, "WorkBuddyAI.exe"),
    );
    expect(env.WORKBUDDY_AI_ELECTRON_BIN).toBe(
      path.join(installRoot, "WorkBuddyAI.exe"),
    );

    env.WORKBUDDY_AI_ELECTRON_BIN = "C:\\custom\\WorkBuddyAI.exe";
    expect(ensureWorkBuddyAiElectronBin(env, "win32")).toBe(
      "C:\\custom\\WorkBuddyAI.exe",
    );
    expect(ensureWorkBuddyAiElectronBin({ LOCALAPPDATA: local }, "darwin")).toBeUndefined();
  });

  it("detects package name and staged lib", () => {
    expect(isWorkBuddyConnectPackage("dsh-workbuddy-connect")).toBe(true);
    expect(isWorkBuddyConnectPackage("@anyone/dsh-workbuddy-connect")).toBe(
      true,
    );
    expect(isWorkBuddyConnectPackage("other")).toBe(false);
    const root = mkdtempSync(path.join(tmpdir(), "wb-lib-"));
    temps.push(root);
    expect(hasWorkBuddyHostLib(root)).toBe(false);
    mkdirSync(path.join(root, "lib"), { recursive: true });
    writeFileSync(path.join(root, "lib", "index.js"), "export function apply() {}");
    expect(hasWorkBuddyHostLib(root)).toBe(true);
  });

  it("applies staged Cordis host half and syncs llm provider", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "wb-apply-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      `export function apply(ctx) {
  ctx.llm.registerAdapter(["workbuddy-ai"], {
    async listModels() {
      return [{
        id: "wb-flash",
        name: "Flash",
        baseUrl: "http://127.0.0.1:3921/v1",
        contextWindow: 128000,
        supportsImages: true,
      }];
    },
    async resolveApiKey() { return "wb-token"; },
  });
  ctx.webServer.register({
    kind: "prefix",
    path: "/plugins/dsh-workbuddy-connect/",
    methods: ["GET"],
    handler: async (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    },
  });
}
`,
    );

    const syncCommunityLlmProvider = vi.fn(async () => undefined);
    const contribution = await tryApplyWorkBuddyHost(
      pkgRoot,
      "dsh-workbuddy-connect",
      { syncCommunityLlmProvider },
    );

    expect(contribution?.meta.id).toBe("dsh-workbuddy-connect-host");
    expect(contribution?.http?.length).toBe(1);
    await vi.waitFor(() => {
      expect(syncCommunityLlmProvider).toHaveBeenCalled();
    });
    expect(syncCommunityLlmProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "workbuddy-ai",
        displayName: "WorkBuddy AI",
        baseUrl: "http://127.0.0.1:3921/v1",
        apiKey: "wb-token",
        models: [
          expect.objectContaining({
            id: "wb-flash",
            name: "Flash",
            contextWindow: 128000,
            inputModalities: ["text", "image"],
          }),
        ],
      }),
    );
  });

  it("retries Face sync after catalog becomes available", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "wb-retry-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      `const readyAt = Date.now() + 250;
export function apply(ctx) {
  ctx.llm.registerAdapter(["workbuddy"], {
    async listModels() {
      if (Date.now() < readyAt) return [];
      return [{
        id: "hy3",
        name: "Hy3",
        baseUrl: "http://127.0.0.1:3922/v1",
        contextWindow: 192000,
      }];
    },
    async resolveApiKey() { return "wb-cn"; },
  });
}
`,
    );

    const syncCommunityLlmProvider = vi.fn(async () => undefined);
    await tryApplyWorkBuddyHost(pkgRoot, "dsh-workbuddy-connect", {
      syncCommunityLlmProvider,
    });
    // Immediate attempts skip; 300ms retry should land after readyAt.
    await vi.waitFor(
      () => {
        expect(syncCommunityLlmProvider).toHaveBeenCalled();
      },
      { timeout: 5_000 },
    );
    expect(syncCommunityLlmProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "workbuddy",
        baseUrl: "http://127.0.0.1:3922/v1",
        models: [expect.objectContaining({ id: "hy3" })],
      }),
    );
  });

  it("returns undefined for non-workbuddy packages", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "wb-skip-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      "export function apply() {}",
    );
    expect(
      await tryApplyWorkBuddyHost(pkgRoot, "dsh-something-else", {}),
    ).toBeUndefined();
  });

  it("rejects unusable loopback baseUrl stubs", () => {
    expect(isUsableCommunityLoopbackBaseUrl("/v1")).toBe(false);
    expect(isUsableCommunityLoopbackBaseUrl("undefined/v1")).toBe(false);
    expect(isUsableCommunityLoopbackBaseUrl("http://127.0.0.1:0/v1")).toBe(false);
    expect(isUsableCommunityLoopbackBaseUrl("http://127.0.0.1:3921/v1")).toBe(
      true,
    );
    expect(
      baseUrlFromCommunityModels([{ id: "x", baseUrl: "/v1" }]),
    ).toBeUndefined();
    expect(
      baseUrlFromCommunityModels([
        { id: "x", baseUrl: "http://127.0.0.1:3921/v1/" },
      ]),
    ).toBe("http://127.0.0.1:3921/v1");
  });

  it("enrichWorkBuddyStatusBody fills models when signed-in roster is gated empty", () => {
    expect(
      enrichWorkBuddyStatusBody(
        { status: "signed-in", models: [] },
        [
          { id: "hy3", name: "Hy3", contextWindow: 192_000 },
          { id: "hy4-preview", name: "Hy4" },
        ],
      ),
    ).toEqual({
      status: "signed-in",
      models: [
        { id: "hy3", name: "Hy3", contextWindow: 192_000 },
        { id: "hy4-preview", name: "Hy4" },
      ],
    });
    expect(
      enrichWorkBuddyStatusBody(
        { status: "signed-out" },
        [{ id: "hy3" }],
      ),
    ).toEqual({ status: "signed-out" });
  });

  it("listModelsForSync prefers full catalog over visibility-filtered listModels", async () => {
    let visible = false;
    const adapter = {
      async listModels() {
        if (!visible) return [];
        // Mimic WorkBuddyPiAiAdapter: only non-hidden ids.
        return [
          {
            id: "hy4-preview-f",
            name: "Hy4 preview · F",
            baseUrl: "http://127.0.0.1:63949/v1",
          },
        ];
      },
      catalog: {
        isVisible: () => visible,
        setVisible: (next: boolean) => {
          visible = next;
        },
        current: () =>
          visible
            ? [
                { id: "hy4-preview-f", name: "Hy4 preview · F" },
                { id: "hy3", name: "Hy3" },
                { id: "deep-model", name: "Deep" },
              ]
            : [],
        fallback: () => [
          { id: "hy4-preview-f", name: "Hy4 preview · F" },
          { id: "hy3", name: "Hy3" },
          { id: "deep-model", name: "Deep" },
        ],
      },
    };

    const rows = await listModelsForSync(adapter, "workbuddy");
    expect(visible).toBe(false); // peek restored
    expect(rows).toEqual([
      {
        id: "hy4-preview-f",
        name: "Hy4 preview · F",
        baseUrl: "http://127.0.0.1:63949/v1",
      },
      {
        id: "hy3",
        name: "Hy3",
        baseUrl: "http://127.0.0.1:63949/v1",
      },
      {
        id: "deep-model",
        name: "Deep",
        baseUrl: "http://127.0.0.1:63949/v1",
      },
    ]);
  });

  it("listModelsForSync keeps plugin setVisible this-binding (Cordis gate)", async () => {
    // Community plugins read this.display.visible; unbound extraction throws.
    const gate = {
      display: { visible: false },
      isVisible() {
        return this.display.visible;
      },
      setVisible(next: boolean) {
        this.display.visible = next;
      },
      current() {
        return this.display.visible
          ? [{ id: "wb-1", name: "WB", baseUrl: "http://127.0.0.1:19090/v1" }]
          : [];
      },
      fallback() {
        return [{ id: "wb-1", name: "WB" }];
      },
    };
    const rows = await listModelsForSync(
      {
        async listModels() {
          return gate.display.visible
            ? [{ id: "wb-1", name: "WB", baseUrl: "http://127.0.0.1:19090/v1" }]
            : [];
        },
        catalog: gate,
      },
      "workbuddy-ai",
    );
    expect(gate.display.visible).toBe(false);
    expect(rows).toEqual([
      { id: "wb-1", name: "WB", baseUrl: "http://127.0.0.1:19090/v1" },
    ]);
  });

  it("listModelsForSync survives a broken setVisible without aborting sync", async () => {
    const rows = await listModelsForSync(
      {
        async listModels() {
          return [{ id: "ok", name: "OK", baseUrl: "http://127.0.0.1:19091/v1" }];
        },
        catalog: {
          isVisible: () => false,
          setVisible: () => {
            throw new TypeError("Cannot read properties of undefined (reading 'visible')");
          },
          current: () => [],
          fallback: () => [{ id: "ok", name: "OK" }],
        },
      },
      "workbuddy-ai",
    );
    expect(rows).toEqual([
      { id: "ok", name: "OK", baseUrl: "http://127.0.0.1:19091/v1" },
    ]);
  });

  it("listModelsForSync stamps lastBaseUrl when listModels is empty", async () => {
    const adapter = {
      async listModels() {
        return [];
      },
      catalog: {
        isVisible: () => true,
        current: () => [],
        fallback: () => [
          { id: "hy3", name: "Hy3" },
          { id: "hy4-preview", name: "Hy4" },
        ],
      },
    };
    const rows = await listModelsForSync(adapter, "workbuddy", {
      lastBaseUrl: "http://127.0.0.1:51635/v1",
    });
    expect(rows).toEqual([
      {
        id: "hy3",
        name: "Hy3",
        baseUrl: "http://127.0.0.1:51635/v1",
      },
      {
        id: "hy4-preview",
        name: "Hy4",
        baseUrl: "http://127.0.0.1:51635/v1",
      },
    ]);
  });

  it("keeps nudging Face sync until every variant succeeds", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "wb-nudge-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      `let cnReady = false;
setTimeout(() => { cnReady = true; }, 400);
export function apply(ctx) {
  ctx.llm.registerAdapter(["workbuddy-ai"], {
    async listModels() {
      return [{
        id: "ai-flash",
        baseUrl: "http://127.0.0.1:63950/v1",
      }];
    },
    async resolveApiKey() { return "ai"; },
  });
  ctx.llm.registerAdapter(["workbuddy"], {
    async listModels() {
      if (!cnReady) return [];
      return [{
        id: "hy4-preview-f",
        baseUrl: "http://127.0.0.1:63949/v1",
      }];
    },
    async resolveApiKey() { return "cn"; },
  });
  ctx.webServer.register({
    kind: "prefix",
    path: "/plugins/dsh-workbuddy-connect/",
    methods: ["GET"],
    handler: async (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "signed-in" }));
    },
  });
}
`,
    );

    const syncCommunityLlmProvider = vi.fn(async () => undefined);
    const contribution = await tryApplyWorkBuddyHost(
      pkgRoot,
      "dsh-workbuddy-connect",
      { syncCommunityLlmProvider },
    );
    expect(contribution?.http?.length).toBe(1);
    const handle = contribution!.http![0]!.handle;

    await vi.waitFor(() => {
      expect(syncCommunityLlmProvider).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: "workbuddy-ai" }),
      );
    });

    // AI already synced; old logic stopped status nudges here. Poll status
    // until CN lands.
    await vi.waitFor(
      async () => {
        await new Promise<void>((resolve, reject) => {
          const res = {
            writeHead() {
              return res;
            },
            end() {
              resolve();
            },
          };
          void handle(
            { method: "GET" } as never,
            res as never,
            "/plugins/dsh-workbuddy-connect/status",
          ).then((ok) => {
            if (!ok) reject(new Error("status unhandled"));
          });
        });
        expect(syncCommunityLlmProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            providerId: "workbuddy",
            baseUrl: "http://127.0.0.1:63949/v1",
          }),
        );
      },
      { timeout: 5_000 },
    );
  });
});
