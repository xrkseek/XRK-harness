import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureWorkBuddyAiElectronBin,
  hasWorkBuddyHostLib,
  isWorkBuddyConnectPackage,
  tryApplyWorkBuddyHost,
} from "../src/dsh-compat/workbuddy-host.js";
import { resetHostApplyRegistry } from "../src/dsh-compat/host-apply-registry.js";

const temps: string[] = [];
const prevAiElectron = process.env.WORKBUDDY_AI_ELECTRON_BIN;

afterEach(() => {
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
});
