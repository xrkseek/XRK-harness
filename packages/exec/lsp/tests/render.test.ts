import { describe, expect, it } from "vitest";
import {
  formatHover,
  formatLocations,
  parseLspArgs,
  presentLspCall,
  renderUri,
} from "../src/index.js";

describe("LSP render", () => {
  it("converts one-based args to zero-based positions", () => {
    expect(
      parseLspArgs({
        operation: "hover",
        file_path: "src/a.ts",
        line: 3,
        character: 5,
      }),
    ).toEqual({
      operation: "hover",
      filePath: "src/a.ts",
      position: { line: 2, character: 4 },
    });
    expect(() =>
      parseLspArgs({
        operation: "nope",
        file_path: "a.ts",
        line: 1,
        character: 1,
      }),
    ).toThrow(/operation must be one of/);
  });

  it("formats locations as one-based workspace paths", () => {
    const text = formatLocations(
      [
        {
          uri: "file:///ws/src/a.ts",
          range: {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 3 },
          },
        },
      ],
      "file:///ws",
      100,
      16_000,
    );
    expect(text).toContain("src/a.ts:3:1");
    expect(formatLocations([], "file:///ws", 100, 16_000)).toBe("No results.");
    expect(formatHover(null, 16_000)).toBe("No hover information.");
  });

  it("keeps non-file URIs verbatim", () => {
    expect(renderUri("untitled:1", "file:///ws")).toBe("untitled:1");
  });

  it("presents a generic search card", () => {
    expect(
      presentLspCall({
        operation: "goToDefinition",
        file_path: "src/a.ts",
        line: 3,
        character: 1,
      }),
    ).toEqual({
      card: "generic",
      kind: "search",
      title: "LSP goToDefinition src/a.ts:3:1",
      locations: [{ path: "src/a.ts", line: 3 }],
    });
  });
});
