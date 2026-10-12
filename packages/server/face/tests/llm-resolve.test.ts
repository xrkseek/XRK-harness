import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { resolveLlmForSession } from "../src/llm-resolve.js";
import { buildFaceModelCatalog } from "../src/model-catalog.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

describe("resolveLlmForSession", () => {
  it("builds deepseek adapter from settings.yaml and .credentials.yaml", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-llm-resolve-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "llm-deepseek:",
        "  baseURL: https://api.deepseek.com",
        "  models:",
        "    - id: deepseek-v4-pro",
        "      name: DeepSeek Chat",
        "agent-default-model:",
        "  provider: deepseek",
        "  model: deepseek-v4-pro",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, ".credentials.yaml"),
      "DEEPSEEK_API_KEY: sk-test-key\n",
      "utf8",
    );

    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const rt = createFaceRuntime({
      store,
      workspaceRoot: dir,
      productDir: dir,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const resolved = resolveLlmForSession(rt, sessionId);
    expect(resolved).toBeDefined();
    expect(resolved!.selection).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    expect(resolved!.adapter.id).toMatch(/^session:/);
    expect(resolved!.binding.baseUrl).toBe("https://api.deepseek.com");
    expect(resolved!.binding.model).toBe("deepseek-v4-pro");
    // Face intake may be text+image; official DeepSeek adapter stays text-only.
    expect(resolved!.adapter.inputModalities).toEqual(["text"]);
  });

  it("keeps official DeepSeek text-only even when Face intake allows images", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-llm-modality-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "llm-deepseek:",
        "  baseURL: https://api.deepseek.com",
        "  models:",
        "    - id: deepseek-v4-pro",
        "agent-default-model:",
        "  provider: deepseek",
        "  model: deepseek-v4-pro",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, ".credentials.yaml"),
      "DEEPSEEK_API_KEY: sk-test-key\n",
      "utf8",
    );

    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const rt = createFaceRuntime({
      store,
      workspaceRoot: dir,
      productDir: dir,
      inputModalities: ["text", "image"],
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const { liveRouteAllowsImageInput } = await import("../src/llm-resolve.js");
    expect(liveRouteAllowsImageInput(rt, sessionId)).toBe(false);
    expect(resolveLlmForSession(rt, sessionId)!.adapter.inputModalities).toEqual(
      ["text"],
    );
  });

  it("allows image on official host when model is vision-exp", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-llm-vision-exp-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "llm-deepseek:",
        "  baseURL: https://api.deepseek.com",
        "  models:",
        "    - id: deepseek-v4-flash-vision-exp",
        "agent-default-model:",
        "  provider: deepseek",
        "  model: deepseek-v4-flash-vision-exp",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, ".credentials.yaml"),
      "DEEPSEEK_API_KEY: sk-test-key\n",
      "utf8",
    );

    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const rt = createFaceRuntime({
      store,
      workspaceRoot: dir,
      productDir: dir,
      inputModalities: ["text", "image"],
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const { liveRouteAllowsImageInput } = await import("../src/llm-resolve.js");
    expect(liveRouteAllowsImageInput(rt, sessionId)).toBe(true);
    expect(resolveLlmForSession(rt, sessionId)!.adapter.inputModalities).toEqual(
      ["text", "image"],
    );
  });

  it("returns undefined when provider requires a key but none is configured", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-llm-resolve-empty-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "agent-default-model:",
        "  provider: deepseek",
        "  model: deepseek-v4-flash",
        "",
      ].join("\n"),
      "utf8",
    );

    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const rt = createFaceRuntime({
        store,
        workspaceRoot: dir,
        productDir: dir,
        drain: drain(),
        resolveAgent: async () => {
          throw new Error("unused");
        },
      });
      expect(resolveLlmForSession(rt, sessionId)).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });
});

describe("buildFaceModelCatalog community / pi-ai reasoning", () => {
  it("keeps reasoning menus from llm-pi-ai model rows (not DeepSeek-only)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-catalog-pi-effort-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "llm-pi-ai:",
        "  providers:",
        "    our-free-model:",
        "      displayName: Our Free Model",
        "      api: openai-chat",
        "      baseURL: http://127.0.0.1:18899/v1",
        "      apiKeyEnv: OUR_FREE_MODEL_API_KEY",
        "      models:",
        "        - id: muse-spark",
        "          name: Muse Spark",
        "          contextWindow: 128000",
        "          reasoning:",
        "            defaultEffort: balanced",
        "            efforts:",
        "              - id: light",
        "                name: Light",
        "              - id: balanced",
        "                name: Balanced",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, ".credentials.yaml"),
      "OUR_FREE_MODEL_API_KEY: sk-test\n",
      "utf8",
    );

    const rt = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: dir,
      productDir: dir,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const { groups } = buildFaceModelCatalog(rt);
    const ofm = groups.find((group) => group.id === "our-free-model");
    expect(ofm?.models[0]).toMatchObject({
      id: "muse-spark",
      reasoning: {
        defaultEffort: "balanced",
        efforts: [
          { id: "light", name: "Light" },
          { id: "balanced", name: "Balanced" },
        ],
      },
    });
  });
});

describe("buildFaceModelCatalog DeepSeek reasoning", () => {
  it("exposes thinking intensity efforts for DeepSeek catalog models", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-catalog-effort-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "llm-deepseek:",
        "  baseURL: https://api.deepseek.com",
        "  reasoningEffort: max",
        "  models:",
        "    - id: deepseek-v4-flash",
        "      name: DeepSeek Chat",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, ".credentials.yaml"),
      "DEEPSEEK_API_KEY: sk-test-key\n",
      "utf8",
    );

    const rt = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: dir,
      productDir: dir,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const { groups } = buildFaceModelCatalog(rt);
    const deepseek = groups.find((group) => group.id === "deepseek");
    expect(deepseek?.models[0]).toMatchObject({
      id: "deepseek-v4-flash",
      reasoning: {
        defaultEffort: "max",
        efforts: [
          { id: "off", name: "Off" },
          { id: "low", name: "Low" },
          { id: "high", name: "High" },
          { id: "max", name: "Max" },
        ],
      },
    });
  });
});
