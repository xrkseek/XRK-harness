/**
 * Turn-end `workspace/changes`: accumulate per-tool FileDiff views, then
 * append one summary via {@link summarizeFileDiffs} (DSH deliverables shape;
 * XRK embeds the summary on the SessionEvent).
 */
import type { SessionStore } from "@xrkseek/core-session";
import type { FileDiff, ToolDefinition } from "@xrkseek/core-tools";
import { flattenText, summarizeFileDiffs } from "@xrkseek/protocol";
import type { ToolResult } from "@xrkseek/protocol";

type PresentableTool = Pick<ToolDefinition, "presentCall" | "presentResult">;

/**
 * Extract FileDiffs from a settled tool via its presenters.
 * Prefer `presentResult` (skips errors); fall back to `presentCall` when the
 * result presenter is absent but the call declared a diff card.
 */
export function fileDiffsFromToolPresenters(input: {
  readonly name: string;
  readonly args: unknown;
  readonly result: ToolResult;
  readonly getTool: (name: string) => PresentableTool | undefined;
}): readonly FileDiff[] {
  const tool = input.getTool(input.name);
  if (!tool) return [];
  try {
    const content =
      typeof input.result.content === "string"
        ? input.result.content
        : flattenText(input.result.content);
    const resultView = tool.presentResult?.(input.args, {
      content,
      ...(input.result.isError ? { isError: true } : {}),
      ...(input.result.meta !== undefined ? { meta: input.result.meta } : {}),
    });
    if (resultView?.card === "diff" && resultView.diffs.length > 0) {
      return resultView.diffs;
    }
    if (input.result.isError) return [];
    const callView = tool.presentCall?.(input.args);
    if (callView?.card === "diff" && callView.diffs.length > 0) {
      return callView.diffs;
    }
  } catch {
    return [];
  }
  return [];
}

/** Append `workspace/changes` when the turn collected any FileDiffs. */
export function appendWorkspaceChangesFromDiffs(input: {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly turnId: string;
  readonly cwd: string;
  readonly diffs: readonly FileDiff[];
  readonly now: () => number;
}): boolean {
  if (input.diffs.length === 0) return false;
  const summary = summarizeFileDiffs({
    turnId: input.turnId,
    cwd: input.cwd,
    diffs: input.diffs,
  });
  if (summary.total === 0) return false;
  input.store.append(input.sessionId, {
    type: "workspace/changes",
    ts: input.now(),
    turnId: input.turnId,
    summary,
  });
  return true;
}
