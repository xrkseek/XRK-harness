import { describe, expect, it } from "vitest";
import {
  coalesceFileDiffTexts,
  summarizeFileDiffs,
  workspaceFileDiffForListedFile,
  workspaceFileDiffFromTexts,
} from "../src/workspace-changes.js";

describe("summarizeFileDiffs", () => {
  it("coalesces paths and caps listed files", () => {
    const summary = summarizeFileDiffs({
      turnId: "t1",
      cwd: "/repo",
      maxFiles: 1,
      diffs: [
        { path: "b.ts", oldText: "x\n", newText: "y\nz\n" },
        { path: "a.ts", oldText: null, newText: "new\n" },
        { path: "b.ts", oldText: "y\nz\n", newText: "final\n" },
      ],
    });
    expect(summary.turnId).toBe("t1");
    expect(summary.total).toBe(2);
    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]?.path).toBe("a.ts");
    expect(summary.added).toBeGreaterThan(0);
  });

  it("counts lines with DiffBlock terminator rule (trailing newline is not a row)", () => {
    const summary = summarizeFileDiffs({
      turnId: "t2",
      cwd: "/repo",
      diffs: [
        { path: "a.txt", oldText: null, newText: "hello\nworld\n" },
        { path: "b.txt", oldText: "old\n", newText: "" },
      ],
    });
    expect(summary.files.find((f) => f.path === "a.txt")).toEqual({
      path: "a.txt",
      display: "a.txt",
      added: 2,
      deleted: 0,
    });
    expect(summary.files.find((f) => f.path === "b.txt")).toEqual({
      path: "b.txt",
      display: "b.txt",
      added: 0,
      deleted: 1,
    });
    expect(summary.added).toBe(2);
    expect(summary.deleted).toBe(1);
  });
});

describe("workspaceFileDiffFromTexts", () => {
  it("builds a coarse whole-file hunk for create", () => {
    const diff = workspaceFileDiffFromTexts({
      path: "a.ts",
      display: "a.ts",
      oldText: null,
      newText: "one\ntwo\n",
    });
    expect(diff).toMatchObject({
      kind: "text",
      before: false,
      after: true,
      coarse: true,
    });
    if (diff.kind !== "text") return;
    expect(diff.hunks[0]?.lines).toEqual(["+one", "+two"]);
  });

  it("marks binary when either side has NUL", () => {
    expect(
      workspaceFileDiffFromTexts({
        path: "b.bin",
        display: "b.bin",
        oldText: null,
        newText: "a\0b",
      }),
    ).toEqual({ kind: "binary", path: "b.bin", display: "b.bin" });
  });
});

describe("workspaceFileDiffForListedFile", () => {
  it("uses first-before last-after across captures", () => {
    const file = {
      path: "a.ts",
      display: "a.ts",
      added: 1,
      deleted: 1,
    };
    const diffs = [
      { path: "a.ts", oldText: "old\n", newText: "mid\n" },
      { path: "a.ts", oldText: "mid\n", newText: "new\n" },
    ];
    expect(coalesceFileDiffTexts(diffs, "a.ts")).toEqual({
      oldText: "old\n",
      newText: "new\n",
    });
    const out = workspaceFileDiffForListedFile({ file, diffs });
    expect(out?.kind).toBe("text");
    if (out?.kind !== "text") return;
    expect(out.hunks[0]?.lines).toEqual(["-old", "+new"]);
  });
});
