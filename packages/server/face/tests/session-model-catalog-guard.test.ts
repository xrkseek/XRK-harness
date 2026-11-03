import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import {
  lookupCatalogModel,
  lookupProviderModelIds,
} from "../src/model-catalog.js";
import { selectSessionModel } from "../src/select-session-model.js";

/**
 * deepseek = a provider WITH a catalog inventory (two rows);
 * empty-gw = a pure custom gateway (baseUrl + protocol, no models at all).
 */
const SETTINGS_YAML = [
  "llm-deepseek:",
  "  baseURL: https://api.deepseek.com",
  "  models:",
  "    - id: deepseek-chat",
  "      name: DeepSeek Chat",
  "    - id: deepseek-v4-flash",
  "      name: DeepSeek Flash",
  "llm-pi-ai:",
  "  providers:",
  "    empty-gw:",
  "      baseURL: http://127.0.0.1:9/v1",
  "      api: openai-completions",
  "agent-default-model:",
  "  provider: deepseek",
  "  model: deepseek-chat",
  "",
].join("\n");

async function guardRuntime() {
  const dir = await mkdtemp(path.join(tmpdir(), "xrk-model-guard-"));
  await writeFile(path.join(dir, "settings.yaml"), SETTINGS_YAML, "utf8");
  await writeFile(
    path.join(dir, ".credentials.yaml"),
    "DEEPSEEK_API_KEY: sk-test-guard\n",
    "utf8",
  );
  const runtime = createBareFaceRuntime({
    store: createMemorySessionStore(),
    productDir: dir,
    workspaceRoot: dir,
  });
  const sessionId = runtime.ensureSession("guard-session");
  return { runtime, sessionId };
}

describe("selectSessionModel model-existence guard", () => {
  it("refuses a mistyped model before reserving, pinning or writing disk", async () => {
    const { runtime, sessionId } = await guardRuntime();

    const res = await selectSessionModel(runtime, {
      sessionId,
      provider: "deepseek",
      model: "beam-free",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("model-unavailable");
      expect(res.error.message).toContain('unknown model "beam-free"');
      expect(res.error.message).toContain('for provider "deepseek"');
      const details = res.error.details as {
        provider: string;
        model: string;
        candidates: string[];
      };
      expect(details.provider).toBe("deepseek");
      expect(details.model).toBe("beam-free");
      // Nothing similar → the head of the catalog, never an empty hint.
      expect(details.candidates.length).toBeGreaterThan(0);
      expect(details.candidates.length).toBeLessThanOrEqual(12);
      expect(details.candidates).toEqual([
        "deepseek-chat",
        "deepseek-v4-flash",
      ]);
    }
    expect(runtime.sessionModels.has(sessionId)).toBe(false);
  });

  it("ranks candidates by prefix first, then substring, capped at 12", async () => {
    const { runtime } = await guardRuntime();

    const known = lookupProviderModelIds(runtime, "deepseek");
    expect(known).toEqual(["deepseek-chat", "deepseek-v4-flash"]);
    // A substring-only hit wins over the catalog head.
    expect(
      lookupCatalogModel(runtime, { provider: "deepseek", model: "flash" }),
    ).toBeUndefined();

    const res = await selectSessionModel(runtime, {
      sessionId: runtime.ensureSession("guard-rank"),
      provider: "deepseek",
      model: "flash",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const candidates = (res.error.details as { candidates: string[] })
        .candidates;
      expect(candidates[0]).toBe("deepseek-v4-flash");
      expect(candidates.length).toBeLessThanOrEqual(12);
    }
  });

  it("keeps a catalog id routable", async () => {
    const { runtime, sessionId } = await guardRuntime();

    const res = await selectSessionModel(runtime, {
      sessionId,
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });

    expect(res.ok).toBe(true);
    expect(runtime.sessionModels.get(sessionId)).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
  });

  it("lets a provider with no catalog inventory through (custom gateway)", async () => {
    const { runtime, sessionId } = await guardRuntime();
    expect(lookupProviderModelIds(runtime, "empty-gw")).toEqual([]);
    expect(
      lookupCatalogModel(runtime, { provider: "empty-gw", model: "anything" }),
    ).toBeUndefined();

    const res = await selectSessionModel(runtime, {
      sessionId,
      provider: "empty-gw",
      model: "anything",
    });

    // Not our guard's business: a typo-shaped id on a gateway that lists no
    // models is accepted (any later provider/credential failure is separate).
    expect(res.ok).toBe(true);
    expect(runtime.sessionModels.get(sessionId)?.model).toBe("anything");
  });

  it("unknown provider still reports provider-not-found, not a model typo", async () => {
    const { runtime, sessionId } = await guardRuntime();

    const res = await selectSessionModel(runtime, {
      sessionId,
      provider: "ghost-provider",
      model: "ghost-model",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).not.toContain('unknown model "');
    }
    expect(runtime.sessionModels.has(sessionId)).toBe(false);
  });
});
