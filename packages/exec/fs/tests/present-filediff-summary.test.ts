import { describe, expect, it } from "vitest";
import { summarizeFileDiffs } from "@xrkseek/protocol";
import {
  presentEditCall,
  presentWriteCall,
} from "../src/present.js";

describe("fs present FileDiff ↔ summarizeFileDiffs", () => {
  it("write present diffs feed summarize with DiffBlock line counts", () => {
    const call = presentWriteCall({
      path: "notes/a.txt",
      content: "hello\nworld\n",
    });
    expect(call?.diffs).toEqual([
      { path: "notes/a.txt", oldText: null, newText: "hello\nworld\n" },
    ]);
    const summary = summarizeFileDiffs({
      turnId: "t1",
      cwd: "/work",
      diffs: call!.diffs,
    });
    expect(summary.files[0]).toEqual({
      path: "notes/a.txt",
      display: "notes/a.txt",
      added: 2,
      deleted: 0,
    });
    expect(summary.added).toBe(2);
    expect(summary.deleted).toBe(0);
  });

  it("edit present diffs use the same FileDiff fields", () => {
    const call = presentEditCall({
      path: "a.txt",
      old_content: "hello\n",
      content: "hello!\n",
    });
    expect(call?.diffs[0]).toEqual({
      path: "a.txt",
      oldText: "hello\n",
      newText: "hello!\n",
    });
    const summary = summarizeFileDiffs({
      turnId: "t1",
      cwd: "/work",
      diffs: call!.diffs,
    });
    expect(summary.files[0]).toMatchObject({
      path: "a.txt",
      added: 1,
      deleted: 1,
    });
  });
});
