/**
 * Rebuild DiffBlock texts from a coarse Face `WorkspaceFileDiff`.
 * Kept Cordis/CSS-free so Node vitest can cover the transform.
 */
import type { WorkspaceFileDiff } from "@xrkseek/xrk-api-remotes/client";

/** Minimal DiffBlock input (matches `@xrkseek/client-ui-primitives` DiffHunk). */
export interface DiffHunkTexts {
  readonly path: string;
  readonly oldText: string | null;
  readonly newText: string | null;
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
    newText: `${newLines.join("\n")}${newLines.length > 0 ? "\n" : ""}`,
  };
}
