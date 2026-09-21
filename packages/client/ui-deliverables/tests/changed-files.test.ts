import { describe, expect, it } from "vitest";
import { diffHunkFromWorkspaceFileDiff } from "../src/client/workspace-file-diff-hunk.ts";

describe("diffHunkFromWorkspaceFileDiff", () => {
  it("rebuilds DiffBlock texts from coarse hunks", () => {
    const hunk = diffHunkFromWorkspaceFileDiff({
      kind: "text",
      path: "a.ts",
      display: "a.ts",
      before: false,
      after: true,
      coarse: true,
      hunks: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
          lines: ["+one", "+two"],
        },
      ],
    });
    expect(hunk).toEqual({
      path: "a.ts",
      oldText: null,
      newText: "one\ntwo\n",
    });
  });

  it("returns null for binary diffs", () => {
    expect(
      diffHunkFromWorkspaceFileDiff({
        kind: "binary",
        path: "a.bin",
        display: "a.bin",
      }),
    ).toBeNull();
  });
});
