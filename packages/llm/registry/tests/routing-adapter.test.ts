import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createRoutingLlmAdapter } from "../src/routing-adapter.js";

describe("createRoutingLlmAdapter", () => {
  it("resolves inner adapter per call from live selection", async () => {
    let selection = { provider: "a", model: "m1" };
    const seen: string[] = [];
    const routing = createRoutingLlmAdapter({
      id: "route-test",
      getSelection: () => selection,
      resolveAdapter: (sel) => {
        seen.push(`${sel.provider}:${sel.model}`);
        return createReplayAdapter([{ content: `ok-${sel.model}` }], sel.model);
      },
    });

    const r1 = await routing.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(r1.content).toBe("ok-m1");
    selection = { provider: "a", model: "m2" };
    const r2 = await routing.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(r2.content).toBe("ok-m2");
    expect(seen).toEqual(["a:m1", "a:m2"]);
    expect(routing.ensureRoute()).toEqual({
      provider: "a",
      model: "m2",
    });
  });

  it("injects selection.reasoningEffort into the inner request", async () => {
    let seenEffort: string | undefined;
    const routing = createRoutingLlmAdapter({
      id: "route-effort",
      getSelection: () => ({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        reasoningEffort: "low",
      }),
      resolveAdapter: () => {
        const inner = createReplayAdapter([{ content: "ok" }]);
        const orig = inner.chat.bind(inner);
        inner.chat = async (req) => {
          seenEffort = req.reasoningEffort;
          return orig(req);
        };
        return inner;
      },
    });
    await routing.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(seenEffort).toBe("low");
    expect(routing.peekRoute()?.reasoningEffort).toBe("low");
  });

  it("puts selection.contextWindow on ensureRoute / peekRoute (request/header)", async () => {
    const routing = createRoutingLlmAdapter({
      id: "route-window",
      getSelection: () => ({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        contextWindow: 128_000,
      }),
      resolveAdapter: () => createReplayAdapter([{ content: "ok" }]),
    });
    expect(routing.ensureRoute()).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      contextWindow: 128_000,
    });
    await routing.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(routing.peekRoute()?.contextWindow).toBe(128_000);
  });
});
