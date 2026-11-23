import { describe, expect, it } from "vitest";
import {
  placeSystemOnWire,
  systemAppendAfterBaseline,
} from "../src/place-system-on-wire.js";

describe("placeSystemOnWire", () => {
  const history = [
    { role: "user" as const, content: "hi" },
    { role: "assistant" as const, content: "yo" },
  ];

  it("leads with system when there is no series baseline", () => {
    const placed = placeSystemOnWire({
      systemText: "PersonaA",
      history,
      systemPromptUpdate: "in-history",
    });
    expect(placed.messages[0]).toEqual({
      role: "system",
      content: "PersonaA",
    });
    expect(placed.seriesBaselineSystem).toBe("PersonaA");
    expect(placed.messages.slice(1)).toEqual(history);
  });

  it("appends only the delta when the new system extends the baseline", () => {
    expect(systemAppendAfterBaseline("PersonaA", "PersonaA\n\n## Extra")).toBe(
      "## Extra",
    );
    const placed = placeSystemOnWire({
      systemText: "PersonaA\n\n## Extra",
      history,
      systemPromptUpdate: "in-history",
      seriesBaselineSystem: "PersonaA",
    });
    expect(placed.messages[0]?.content).toBe("PersonaA");
    expect(placed.messages.at(-1)).toEqual({
      role: "system",
      content: "## Extra",
    });
    expect(placed.seriesBaselineSystem).toBe("PersonaA");
    expect(placed.messages.slice(1, -1)).toEqual(history);
  });

  it("appends the full text when the new system does not share the baseline prefix", () => {
    const placed = placeSystemOnWire({
      systemText: "PersonaB\n\nother",
      history,
      systemPromptUpdate: "in-history",
      seriesBaselineSystem: "PersonaA",
    });
    expect(placed.messages.at(-1)?.content).toBe("PersonaB\n\nother");
  });

  it("rewrites the head when the adapter omits systemPromptUpdate", () => {
    const placed = placeSystemOnWire({
      systemText: "PersonaA\n\n## Extra",
      history,
      seriesBaselineSystem: "PersonaA",
    });
    expect(placed.messages).toHaveLength(3);
    expect(placed.messages[0]?.content).toBe("PersonaA\n\n## Extra");
    expect(placed.seriesBaselineSystem).toBe("PersonaA\n\n## Extra");
  });

  it("omits a blank system and keeps the prior baseline", () => {
    const placed = placeSystemOnWire({
      systemText: "   ",
      history,
      systemPromptUpdate: "in-history",
      seriesBaselineSystem: "PersonaA",
    });
    expect(placed.messages).toEqual(history);
    expect(placed.seriesBaselineSystem).toBe("PersonaA");
  });
});
