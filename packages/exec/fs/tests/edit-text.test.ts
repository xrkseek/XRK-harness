import { describe, expect, it } from "vitest";
import {
  EditAmbiguousError,
  applyLiteralEdit,
} from "../src/edit-text.js";

describe("applyLiteralEdit", () => {
  it("exact match still wins and reports exact tier", () => {
    const out = applyLiteralEdit("a\nold\nb\n", "old", "new", false, "f.ts");
    expect(out).toEqual({
      content: "a\nnew\nb\n",
      replacements: 1,
      matchTier: "exact",
    });
  });

  it("rstrip tier matches when only trailing spaces differ", () => {
    const out = applyLiteralEdit(
      "  hello  \nworld\n",
      "  hello\nworld",
      "x",
      false,
      "f.ts",
    );
    expect(out.matchTier).toBe("rstrip");
    expect(out.content).toBe("x\n");
    expect(out.replacements).toBe(1);
  });

  it("trim tier matches when leading spaces differ (exact/rstrip miss)", () => {
    // File has trailing spaces; needle has leading spaces — only full trim aligns.
    const out = applyLiteralEdit(
      "hello  \n",
      "  hello",
      "hi",
      false,
      "f.ts",
    );
    expect(out.matchTier).toBe("trim");
    expect(out.content).toBe("hi\n");
  });

  it("still throws EditAmbiguousError when fuzzy match is not unique", () => {
    expect(() =>
      applyLiteralEdit("x  \ny\nx  \ny\n", "x\ny", "z", false, "f.ts"),
    ).toThrow(EditAmbiguousError);
  });

  it("replace_all skips overlapping fuzzy windows", () => {
    const out = applyLiteralEdit(
      "aa  \naa  \naa  \n",
      "aa\naa",
      "z",
      true,
      "f.ts",
    );
    expect(out.matchTier).toBe("rstrip");
    expect(out.replacements).toBe(1);
    expect(out.content).toBe("z\naa  \n");
  });

  it("does not treat a whitespace-only line as a trailing newline boundary", () => {
    expect(() =>
      applyLiteralEdit("hello \n   \n", "hello\n", "x\n", false, "f.ts"),
    ).toThrow(/edit mismatch/);
  });

  it("reports mismatch when no tier hits", () => {
    expect(() =>
      applyLiteralEdit("abc\n", "zzz", "q", false, "f.ts"),
    ).toThrow(/edit mismatch/);
  });
});
