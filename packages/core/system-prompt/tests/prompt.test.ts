import { describe, expect, it } from "vitest";
import {
  createSystemPromptAssembler,
  interpolatePromptText,
  renderPromptSections,
} from "../src/index.js";

describe("system-prompt", () => {
  it("assembles sections by order", async () => {
    const a = createSystemPromptAssembler();
    a.register({ id: "b", order: 2, content: () => "B" });
    a.register({ id: "a", order: 1, content: () => "A" });
    expect(await a.assemble()).toBe("A\n\nB");
  });

  it("interpolates {{name}} in ordinary sections", async () => {
    const a = createSystemPromptAssembler();
    a.variable("model", () => "actual-model");
    a.register({
      id: "persona",
      order: 0,
      content: () => "You run on {{model}}.",
    });
    expect(await a.assemble()).toBe("You run on actual-model.");
  });

  it("preserves literal braces in tools:sdk (interpolate: false)", async () => {
    const description =
      "Expand {{item}} with {{model}} or {{ model }}.";
    const a = createSystemPromptAssembler();
    a.variable("model", () => "actual-model");
    a.register({
      id: "persona",
      order: 0,
      content: () => "Model {{model}}.",
    });
    a.register({
      id: "tools:sdk",
      order: 5000,
      interpolate: false,
      content: () =>
        `declare const tools: {\n  /** ${description} */\n  template: { value: '{{item}}' | '{{model}}' };\n};`,
    });
    const prompt = await a.assemble();
    expect(prompt).toContain("Model actual-model.");
    expect(prompt).toContain(description);
    expect(prompt).toContain("'{{item}}' | '{{model}}'");
    // SDK section must not consume the registered model variable.
    expect(prompt).not.toMatch(/template: \{ value: '.*actual-model/);
  });

  it("renderPromptSections skips interpolation when flagged", () => {
    const text = "Use {{item}} and {{model}}.";
    expect(
      renderPromptSections(
        [{ name: "tools:sdk", text, interpolate: false }],
        { model: "x" },
      ),
    ).toBe(text);
  });

  it("interpolatePromptText rejects unknown variables", () => {
    expect(() =>
      interpolatePromptText("hi {{model}}", {}, 'section "s"'),
    ).toThrow(/unknown prompt variable/);
  });
});
