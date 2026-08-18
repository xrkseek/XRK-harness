import { describe, expect, it } from "vitest";
import {
  normalizeHover,
  normalizeLocations,
  requestMethod,
  supportsOperation,
  supportsTransientOpen,
} from "../src/index.js";

describe("LSP translate", () => {
  it("maps operations to wire methods", () => {
    expect(requestMethod("goToDefinition")).toBe("textDocument/definition");
    expect(requestMethod("findReferences")).toBe("textDocument/references");
    expect(requestMethod("goToImplementation")).toBe(
      "textDocument/implementation",
    );
    expect(requestMethod("hover")).toBe("textDocument/hover");
  });

  it("reads provider capabilities and transient open", () => {
    expect(
      supportsOperation({ definitionProvider: true }, "goToDefinition"),
    ).toBe(true);
    expect(supportsOperation({ hoverProvider: false }, "hover")).toBe(false);
    expect(supportsTransientOpen(1)).toBe(true);
    expect(supportsTransientOpen(0)).toBe(false);
    expect(supportsTransientOpen({ openClose: true })).toBe(true);
    expect(supportsTransientOpen({ change: 1 })).toBe(false);
  });

  it("normalizes Location and LocationLink", () => {
    expect(
      normalizeLocations({
        uri: "file:///a.ts",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 4 },
        },
      }),
    ).toEqual([
      {
        uri: "file:///a.ts",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 4 },
        },
      },
    ]);
    expect(
      normalizeLocations([
        {
          targetUri: "file:///b.ts",
          targetSelectionRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ]),
    ).toEqual([
      {
        uri: "file:///b.ts",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ]);
    expect(normalizeLocations(null)).toEqual([]);
  });

  it("normalizes hover encodings", () => {
    expect(
      normalizeHover({ contents: { kind: "markdown", value: "Hi" } }),
    ).toEqual({ contents: "Hi" });
    expect(normalizeHover({ contents: "plain" })).toEqual({ contents: "plain" });
    expect(
      normalizeHover({
        contents: { language: "ts", value: "x" },
      })?.contents,
    ).toContain("```ts");
    expect(normalizeHover(null)).toBeNull();
  });
});
