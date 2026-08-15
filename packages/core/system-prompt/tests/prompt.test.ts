import { describe, expect, it } from "vitest";
import { createSystemPromptAssembler } from "../src/index.js";

describe("system-prompt", () => {
  it("assembles sections by order", async () => {
    const a = createSystemPromptAssembler();
    a.register({ id: "b", order: 2, content: () => "B" });
    a.register({ id: "a", order: 1, content: () => "A" });
    expect(await a.assemble()).toBe("A\n\nB");
  });
});
