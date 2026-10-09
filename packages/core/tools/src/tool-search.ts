/**
 * Meta-tool: expand Deferred tools into the session LLM catalog.
 * Must not appear in its own search directory.
 */

import type { ToolDefinition } from "./definition.js";
import {
  TOOL_SEARCH_DEFAULT_LIMIT,
  TOOL_SEARCH_NAME,
  formatDeferredCatalog,
  searchDeferredTools,
} from "./tool-exposure.js";

export interface ToolSearchState {
  readonly listExpanded: () => ReadonlySet<string>;
  readonly expand: (names: readonly string[]) => void;
}

export interface CreateToolSearchToolOptions {
  /** Live registry list (includes Deferred). */
  readonly listTools: () => readonly ToolDefinition[];
  readonly state: ToolSearchState;
  readonly limit?: number;
}

function buildDescription(
  listTools: () => readonly ToolDefinition[],
  limitDefault: number,
): string {
  const catalog = formatDeferredCatalog(listTools());
  return (
    "Search deferred tools by keyword and expand up to " +
    `${limitDefault} full schemas into subsequent turns. ` +
    "Use when you need an MCP or other deferred tool not yet in the tools list.\n" +
    "Deferred catalog:\n" +
    catalog
  );
}

export function createToolSearchTool(
  options: CreateToolSearchToolOptions,
): ToolDefinition<{ query?: string; limit?: number }> {
  const limitDefault = options.limit ?? TOOL_SEARCH_DEFAULT_LIMIT;
  return {
    name: TOOL_SEARCH_NAME,
    exposure: "direct",
    description: buildDescription(options.listTools, limitDefault),
    dynamicSchema() {
      return {
        description: buildDescription(options.listTools, limitDefault),
      };
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keywords matching tool names, descriptions, or parameter names.",
        },
        limit: {
          type: "integer",
          description: `Max tools to expand (default ${limitDefault}, max ${limitDefault}).`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(args) {
      const query = typeof args?.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          content: "tool_search requires a non-empty query.",
          isError: true,
        };
      }
      const rawLimit =
        typeof args?.limit === "number" && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : limitDefault;
      const limit = Math.min(Math.max(1, rawLimit), limitDefault);
      const already = options.state.listExpanded();
      const hits = searchDeferredTools(options.listTools(), query, {
        limit,
        excludeExpanded: already,
      });
      if (hits.length === 0) {
        return {
          content:
            already.size > 0
              ? `No new deferred tools matched ${JSON.stringify(query)}. Already expanded: ${[...already].sort().join(", ") || "(none)"}.`
              : `No deferred tools matched ${JSON.stringify(query)}.`,
        };
      }
      const names = hits.map((h) => h.name);
      options.state.expand(names);
      const lines = hits.map(
        (h) =>
          `- ${h.name}: ${h.description.replace(/\s+/g, " ").trim().slice(0, 160)}`,
      );
      return {
        content: [
          `Expanded ${names.length} tool(s) for this session:`,
          ...lines,
          "Full schemas appear in the next model tools list.",
        ].join("\n"),
      };
    },
    isConcurrencySafe: () => true,
  };
}
