import { describe, expect, it, vi } from "vitest";
import {
  communityLoopbackEndpointFromBits,
  communityLoopbackEndpointFromForwardSettings,
  createCommunityLoopbackLlmBridge,
} from "../src/dsh-compat/community-loopback-llm-bridge.js";
import { isOurFreeModelFaceProvider } from "../src/dsh-compat/our-free-model-host.js";

describe("communityLoopbackEndpointFromBits", () => {
  it("rejects port 0 but keeps apiKey", () => {
    expect(
      communityLoopbackEndpointFromBits({
        host: "127.0.0.1",
        port: 0,
        apiKey: "k",
      }),
    ).toEqual({ apiKey: "k" });
  });

  it("builds usable loopback baseUrl", () => {
    expect(
      communityLoopbackEndpointFromBits({
        host: "127.0.0.1",
        port: 18899,
        apiKey: "k",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:18899/v1",
      apiKey: "k",
    });
  });
});

describe("communityLoopbackEndpointFromForwardSettings", () => {
  it("prefers actualPort over requested port 0", () => {
    expect(
      communityLoopbackEndpointFromForwardSettings({
        forward: {
          enabled: true,
          running: true,
          host: "127.0.0.1",
          port: 0,
          actualPort: 45678,
        },
        forwardKey: "ofm-key",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:45678/v1",
      apiKey: "ofm-key",
    });
  });

  it("returns empty when forward not running", () => {
    expect(
      communityLoopbackEndpointFromForwardSettings({
        forward: {
          enabled: true,
          running: false,
          host: "127.0.0.1",
          actualPort: 1,
        },
      }),
    ).toEqual({});
  });
});

describe("createCommunityLoopbackLlmBridge shouldSyncProvider", () => {
  it("Face-syncs only allowlisted providers; channel-pack ids settle without sync", async () => {
    const synced: string[] = [];
    const bridge = createCommunityLoopbackLlmBridge({
      shouldSyncProvider: isOurFreeModelFaceProvider,
      displayName: (id) => id,
      resolveEndpoint: () => ({
        baseUrl: "http://127.0.0.1:18899/v1",
        apiKey: "k",
      }),
      async syncCommunityLlmProvider(args) {
        synced.push(args.providerId);
      },
    });

    const root = {
      on: vi.fn(),
      provide(_key: string, value: {
        registerAdapter: (
          providers: string[],
          adapter: {
            listModels: (provider: string) => Promise<unknown[]>;
          },
        ) => unknown;
      }) {
        // Free-lane routes (OFM index.js registerAdapter)
        value.registerAdapter(["our-free-model", "our-free-model-region"], {
          async listModels(provider) {
            if (provider === "our-free-model") {
              return [{ id: "m1", name: "M1" }];
            }
            return [];
          },
        });
        // Channel-pack product ids share the same Cordis llm
        value.registerAdapter(["gemini", "zcode"], {
          async listModels() {
            return [{ id: "g1", name: "G1" }];
          },
        });
      },
    };

    bridge.provideLlm(root as never);
    await vi.waitFor(() => {
      expect(bridge.scheduler.settled()).toBe(true);
    });
    expect(synced).toEqual(["our-free-model"]);
    bridge.dispose();
  });

  it("waits for real apiKey when defaultApiKey is omitted (OFM forwardKey)", async () => {
    let endpoint: { baseUrl?: string; apiKey?: string } = {
      baseUrl: "http://127.0.0.1:18899/v1",
    };
    const synced: Array<{ apiKey: string }> = [];
    const bridge = createCommunityLoopbackLlmBridge({
      shouldSyncProvider: isOurFreeModelFaceProvider,
      displayName: (id) => id,
      resolveEndpoint: () => endpoint,
      async syncCommunityLlmProvider(args) {
        synced.push({ apiKey: args.apiKey });
      },
    });
    const root = {
      on: vi.fn(),
      provide(
        _key: string,
        value: {
          registerAdapter: (
            providers: string[],
            adapter: { listModels: () => Promise<unknown[]> },
          ) => unknown;
        },
      ) {
        value.registerAdapter(["our-free-model"], {
          async listModels() {
            return [{ id: "m1", name: "M1" }];
          },
        });
      },
    };
    bridge.provideLlm(root as never);
    await vi.waitFor(() => {
      expect(bridge.scheduler.settled()).toBe(false);
    });
    expect(synced).toEqual([]);
    endpoint = {
      baseUrl: "http://127.0.0.1:18899/v1",
      apiKey: "ofm-real-key",
    };
    bridge.requestSync(true);
    await vi.waitFor(() => {
      expect(bridge.scheduler.settled()).toBe(true);
    });
    expect(synced).toEqual([{ apiKey: "ofm-real-key" }]);
    bridge.dispose();
  });
});

describe("createCommunityLoopbackLlmBridge Cordis catalog (channel-pack)", () => {
  it("exposes listModels / listProviders for registered adapters", async () => {
    let llm: {
      listModels: (provider: string) => Promise<unknown[]>;
      listProviders: () => { id: string }[];
      resolveModel: (provider: string, model: string) => Promise<unknown>;
      registerAdapter: (
        providers: string[],
        adapter: {
          listModels: (provider: string) => Promise<unknown[]>;
          resolveModel?: (provider: string, model: string) => Promise<unknown>;
        },
      ) => unknown;
    } | undefined;
    const bridge = createCommunityLoopbackLlmBridge({
      shouldSyncProvider: () => false,
      displayName: (id) => id,
    });
    const root = {
      on: vi.fn(),
      provide(_key: string, value: typeof llm) {
        llm = value;
      },
    };
    bridge.provideLlm(root as never);
    expect(llm).toBeDefined();
    llm!.registerAdapter(["qodercn"], {
      async listModels() {
        return [{ id: "gmodel", name: "GLM-5.3" }];
      },
      async resolveModel(_provider, model) {
        return { id: model, reasoning: { efforts: ["high"] } };
      },
    });
    expect(llm!.listProviders()).toEqual([{ id: "qodercn" }]);
    expect(await llm!.listModels("qodercn")).toEqual([
      { id: "gmodel", name: "GLM-5.3" },
    ]);
    expect(await llm!.listModels("missing")).toEqual([]);
    expect(await llm!.resolveModel("qodercn", "gmodel")).toEqual({
      id: "gmodel",
      reasoning: { efforts: ["high"] },
    });
    bridge.dispose();
  });
});
