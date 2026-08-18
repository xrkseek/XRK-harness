import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/html-text.js";

describe("htmlToText", () => {
  it("strips scripts and collapses whitespace", () => {
    const out = htmlToText(
      "<html><script>alert(1)</script><p>Hello&nbsp;<b>world</b></p></html>",
      10_000,
    );
    expect(out.truncated).toBe(false);
    expect(out.text).toContain("Hello");
    expect(out.text).toContain("world");
    expect(out.text).not.toContain("alert");
  });

  it("caps output", () => {
    const out = htmlToText("<p>abcdefghij</p>", 4);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(4);
  });
});
