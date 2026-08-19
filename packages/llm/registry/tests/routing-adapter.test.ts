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
});
