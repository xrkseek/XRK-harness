/**
 * Rebuild DiffBlock texts from a coarse Face `WorkspaceFileDiff`.
 * Kept Cordis/CSS-free so Node vitest can cover the transform.
 */
import type { WorkspaceFileDiff } from "@xrkseek/xrk-api-remotes/client";

/** Minimal DiffBlock input (matches `@xrkseek/client-ui-primitives` DiffHunk). */
export interface DiffHunkTexts {
  readonly path: string;
  readonly oldText: string | null;
  /** Empty string for whole-file delete (`after: false`); never null. */
  readonly newText: string;
}

export function diffHunkFromWorkspaceFileDiff(
  diff: WorkspaceFileDiff,
): DiffHunkTexts | null {
  if (diff.kind !== "text") return null;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const body = line.slice(1);
      if (line.startsWith("-")) oldLines.push(body);
      else if (line.startsWith("+")) newLines.push(body);
      else {
        oldLines.push(body);
        newLines.push(body);
      }
    }
  }
  return {
    path: diff.path,
    oldText: diff.before
      ? `${oldLines.join("\n")}${oldLines.length > 0 ? "\n" : ""}`
      : null,
    // Mirror Face `after`: deleted files feed DiffBlock an empty added side.
    newText: diff.after
      ? `${newLines.join("\n")}${newLines.length > 0 ? "\n" : ""}`
      : "",
  };
}
