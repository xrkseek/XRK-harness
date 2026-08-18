import { describe, expect, it } from "vitest";
import {
  presentEditCall,
  presentGlobCall,
  presentGlobResult,
  presentGrepCall,
  presentGrepResult,
  presentReadCall,
  presentReadResult,
  presentWriteCall,
  presentWriteResult,
} from "../src/present.js";

describe("fs presenters (DSH tool-fs / tool-fs-search)", () => {
  it("read call is generic kind=read; result is a read card", () => {
    expect(presentReadCall({ path: "src/a.ts" })).toEqual({
      card: "generic",
      title: "Read src/a.ts",
      kind: "read",
      locations: [{ path: "src/a.ts", line: 1 }],
    });
    expect(
      presentReadResult(
        { path: "src/a.ts" },
        { content: "export const x = 1;\n" },
      ),
    ).toMatchObject({
      card: "read",
      path: "src/a.ts",
      offset: 1,
      lang: "ts",
      totalLines: 2,
      lines: [
        { number: 1, text: "export const x = 1;" },
        { number: 2, text: "" },
      ],
    });
  });

  it("write / edit are diff cards; errors decline", () => {
    expect(
      presentWriteCall({ path: "a.txt", content: "hello" }),
    ).toEqual({
      card: "diff",
      title: "Write a.txt",
      diffs: [{ path: "a.txt", oldText: null, newText: "hello" }],
      locations: [{ path: "a.txt" }],
    });
    expect(
      presentWriteResult(
        { path: "a.txt", content: "hello" },
        { content: "wrote a.txt", isError: true },
      ),
    ).toBeUndefined();
    expect(
      presentEditCall({
        path: "a.txt",
        old_content: "hello",
        content: "hello!",
      }),
    ).toEqual({
      card: "diff",
      title: "Edit a.txt",
      diffs: [{ path: "a.txt", oldText: "hello", newText: "hello!" }],
      locations: [{ path: "a.txt" }],
    });
  });

  it("grep call titles like DSH; result groups path:line:text", () => {
    expect(
      presentGrepCall({ pattern: "foo", path: "src", glob: "*.ts" }),
    ).toEqual({
      card: "generic",
      title: "Grep foo in src (*.ts)",
      kind: "search",
      rawInput: "foo",
    });
    expect(
      presentGrepResult(
        { pattern: "foo" },
        { content: "src/a.ts:3:foo\nsrc/a.ts:8:foo bar\nsrc/b.ts:1:foo" },
      ),
    ).toEqual({
      card: "search",
      shape: "matches",
      truncated: false,
      total: 3,
      files: [
        {
          path: "src/a.ts",
          matches: [
            { lineNumber: 3, line: "foo" },
            { lineNumber: 8, line: "foo bar" },
          ],
        },
        {
          path: "src/b.ts",
          matches: [{ lineNumber: 1, line: "foo" }],
        },
      ],
    });
  });

  it("glob call titles like DSH; result is shape=paths", () => {
    expect(presentGlobCall({ pattern: "*.ts" })).toEqual({
      card: "generic",
      title: "Glob *.ts",
      kind: "search",
      rawInput: "*.ts",
    });
    expect(
      presentGlobResult({ pattern: "*.ts" }, { content: "a.ts\nb.ts" }),
    ).toEqual({
      card: "search",
      shape: "paths",
      paths: ["a.ts", "b.ts"],
      truncated: false,
      total: 2,
    });
  });
});
