import type { McpToolInfo } from "./types.js";

/** One `tools/list` page after local mapping. */
export interface McpToolsListPage {
  readonly tools: readonly McpToolInfo[];
  /** Continuation token; absent / empty ends pagination. */
  readonly nextCursor?: string | null;
}

/**
 * Hard cap on `tools/list` pages per discovery (cycle detection alone is not
 * enough when every cursor is unique). Matches a conservative MCP client bound.
 */
export const MAX_TOOLS_LIST_PAGES = 100;

/**
 * Drain paginated `tools/list` into one generation.
 * A repeated `nextCursor` rejects without returning a partial list — callers
 * that already registered tools keep the previous generation (register watch).
 * Exceeding {@link MAX_TOOLS_LIST_PAGES} also rejects (non-terminating pagination).
 */
export async function drainToolsListPages(
  serverName: string,
  fetchPage: (cursor?: string) => Promise<McpToolsListPage>,
): Promise<McpToolInfo[]> {
  const seenCursors = new Set<string>();
  const byName = new Map<string, McpToolInfo>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    if (pages > MAX_TOOLS_LIST_PAGES) {
      throw new Error(
        `mcp-client(${serverName}): tools/list exceeded ${MAX_TOOLS_LIST_PAGES} pages — invalid tool list`,
      );
    }
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

/**
 * True when `tools/list` is unsupported (no tools capability, or MethodNotFound).
 * Empty tool lists from capable servers are not treated as unsupported.
 */
export function isToolsListUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown };
  if (err.code === -32601) return true;
  const message = String(err.message ?? "");
  return (
    /MethodNotFound/i.test(message) ||
    /does not support tools/i.test(message) ||
    /method not found/i.test(message)
  );
}

/**
 * True when a resources/* method is unsupported (MethodNotFound / capability).
 */
export function isResourcesUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown };
  if (err.code === -32601) return true;
  const message = String(err.message ?? "");
  return (
    /MethodNotFound/i.test(message) ||
    /does not support resources/i.test(message) ||
    /method not found/i.test(message)
  );
}
