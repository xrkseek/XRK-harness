import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { resolveLlmForSession } from "../src/llm-resolve.js";
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
        "    - id: deepseek-v4-flash",
        "      name: DeepSeek Chat",
        "agent-default-model:",
        "  provider: deepseek",
        "  model: deepseek-v4-flash",
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
      model: "deepseek-v4-flash",
    });
    expect(resolved!.adapter.id).toMatch(/^session:/);
    expect(resolved!.binding.baseUrl).toBe("https://api.deepseek.com");
    expect(resolved!.binding.model).toBe("deepseek-v4-flash");
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
