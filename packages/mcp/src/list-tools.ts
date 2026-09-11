import type { McpToolInfo } from "./types.js";

/** One `tools/list` page after local mapping. */
export interface McpToolsListPage {
  readonly tools: readonly McpToolInfo[];
  /** Continuation token; absent / empty ends pagination. */
  readonly nextCursor?: string | null;
}

/**
 * Drain paginated `tools/list` into one generation.
 * A repeated `nextCursor` rejects without returning a partial list — callers
 * that already registered tools keep the previous generation (register watch).
 */
export async function drainToolsListPages(
  serverName: string,
  fetchPage: (cursor?: string) => Promise<McpToolsListPage>,
): Promise<McpToolInfo[]> {
  const seenCursors = new Set<string>();
  const byName = new Map<string, McpToolInfo>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const tool of page.tools) {
      if (byName.has(tool.name)) {
        throw new Error(
          `mcp-client(${serverName}): server listed tool "${tool.name}" more than once — invalid tool list`,
        );
      }
      byName.set(tool.name, tool);
    }
    const next =
      typeof page.nextCursor === "string" && page.nextCursor.length > 0
        ? page.nextCursor
        : undefined;
    if (next !== undefined) {
      if (seenCursors.has(next)) {
        throw new Error(
          `mcp-client(${serverName}): server repeated a tools/list continuation cursor — invalid tool list`,
        );
      }
      seenCursors.add(next);
    }
    cursor = next;
  } while (cursor !== undefined);
  return [...byName.values()];
}
