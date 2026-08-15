import { describe, expect, it, vi } from "vitest";
import { createProviderRegistry } from "../src/registry.js";
import { resolveLlmFromEnv } from "../src/from-env.js";

describe("resolveLlmFromEnv", () => {
  it("returns undefined without XRK_LLM_PRESET", () => {
    expect(resolveLlmFromEnv({})).toBeUndefined();
  });

  it("builds groq adapter from env", async () => {
    const reg = createProviderRegistry();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200 },
      ),
    );
    const got = resolveLlmFromEnv(
      {
        XRK_LLM_PRESET: "groq",
        GROQ_API_KEY: "sk",
        XRK_LLM_MODEL: "llama",
      },
      reg,
    );
    expect(got?.binding.provider).toBe("groq");
    expect(got?.binding.model).toBe("llama");
    expect(got?.adapter.id).toBe("groq");
    // re-create with fetch for chat smoke
    const adapter = reg.createAdapter(got!.binding, { apiKey: "sk" }, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    await adapter.chat({ messages: [{ role: "user", content: "x" }] });
    expect(fetchMock).toHaveBeenCalled();
  });
});
