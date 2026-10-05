import { describe, expect, it } from "vitest";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { resolveSessionModelSelection } from "../src/model-catalog.js";

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
