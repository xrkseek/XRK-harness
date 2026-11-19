import { describe, expect, it } from "vitest";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { resolveSessionModelSelection } from "../src/model-catalog.js";
import { selectSessionModel } from "../src/select-session-model.js";

describe("resolveSessionModelSelection", () => {
  it("prefers the last request/header over Settings default and catalog", () => {
    const runtime = createBareFaceRuntime();
    const created = runtime.store.create();
    runtime.store.append(created.id, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: {
          provider: "deepseek",
          model: "deepseek-chat",
          reasoningEffort: "high",
        },
      },
    });
    runtime.settingsNamespaces.ensure("agent-default-model").user = {
      provider: "xiaomi",
      model: "mimo-v2.6-flash-free",
    };

    expect(resolveSessionModelSelection(runtime, created.id)).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      reasoningEffort: "high",
    });
  });

  it("keeps an explicit selectModel pin over the log route", () => {
    const runtime = createBareFaceRuntime();
    const created = runtime.store.create();
    runtime.store.append(created.id, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: { config: { provider: "deepseek", model: "deepseek-chat" } },
    });
    runtime.sessionModels.set(created.id, {
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5",
    });

    expect(resolveSessionModelSelection(runtime, created.id)).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5",
    });
  });
});

describe("selectSessionModel remount", () => {
  it("invalidates the session Agent when the route changes", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-model-remount-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "llm-pi-ai:",
        "  providers:",
        "    empty-gw:",
        "      baseURL: http://127.0.0.1:9/v1",
        "      api: openai-completions",
        "",
      ].join("\n"),
      "utf8",
    );
    const invalidated: string[] = [];
    const runtime = createBareFaceRuntime({
      productDir: dir,
      workspaceRoot: dir,
      invalidateAgent: async (sessionId) => {
        invalidated.push(sessionId);
      },
    });
    const sessionId = runtime.ensureSession("remount");
    runtime.sessionModels.set(sessionId, {
      provider: "empty-gw",
      model: "old",
    });

    const result = await selectSessionModel(runtime, {
      sessionId,
      provider: "empty-gw",
      model: "new",
    });

    expect(result.ok).toBe(true);
    expect(invalidated).toEqual([sessionId]);
  });
});

describe("selectSessionModel reasoning effort", () => {
  it("rejects an undeclared effort without pinning or persisting it", async () => {
    const runtime = createBareFaceRuntime();
    const created = runtime.store.create();

    const result = await selectSessionModel(runtime, {
      sessionId: created.id,
      provider: "deepseek",
      model: "deepseek-flash",
      reasoningEffort: "ultra",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("effort-unsupported");
    expect(result.error.message).toBe(
      'effort "ultra" is not supported by deepseek/deepseek-flash',
    );
    expect(result.error.details).toEqual({
      provider: "deepseek",
      model: "deepseek-flash",
      effort: "ultra",
      legal: ["off", "low", "high", "max"],
    });
    expect(runtime.sessionModels.has(created.id)).toBe(false);
  });

  it("lets a declared effort through the gate (later failures are not effort errors)", async () => {
    const runtime = createBareFaceRuntime();
    const created = runtime.store.create();

    const result = await selectSessionModel(runtime, {
      sessionId: created.id,
      provider: "deepseek",
      model: "deepseek-flash",
      reasoningEffort: "max",
    });

    if (!result.ok) {
      expect(result.error.code).not.toBe("effort-unsupported");
    }
  });
});
