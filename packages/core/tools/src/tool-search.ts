/**
 * Meta-tool: expand Deferred tools into the session LLM catalog.
 * Must not appear in its own search directory.
 *
 * Description stays byte-stable (no live deferred catalog in tools[]) so
 * provider KV prefix reuse survives MCP connect/disconnect churn. Browse the
 * catalog with query `list` / `*` / empty; expand with a keyword query.
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

/** Stable tools[] copy — live names live in execute results only (KV prefix). */
export function toolSearchDescription(limitDefault: number): string {
  return (
    "Search deferred tools by keyword and expand up to " +
    `${limitDefault} full schemas into subsequent turns. ` +
    "Use when you need an MCP or other deferred tool not yet in the tools list. " +
    "query `list` / `*` / empty → browse the deferred catalog without expanding; " +
    "a keyword query expands matches."
  );
}

function isCatalogBrowseQuery(query: string): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase();
  return q === "*" || q === "list" || q === "ls" || q === "catalog";
}

export function createToolSearchTool(
  options: CreateToolSearchToolOptions,
): ToolDefinition<{ query?: string; limit?: number }> {
  const limitDefault = options.limit ?? TOOL_SEARCH_DEFAULT_LIMIT;
  const description = toolSearchDescription(limitDefault);
  return {
    name: TOOL_SEARCH_NAME,
    exposure: "direct",
    description,
    // Do not re-inject live catalogs — membership churn must not rewrite tools[].
    dynamicSchema: () => ({}),
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keywords to expand, or `list`/`*`/empty to browse the deferred catalog without expanding.",
        },
        limit: {
          type: "integer",
          description: `Max tools to expand (default ${limitDefault}, max ${limitDefault}).`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args) {
      const query = typeof args?.query === "string" ? args.query.trim() : "";
      if (isCatalogBrowseQuery(query)) {
        const catalog = formatDeferredCatalog(options.listTools());
        const already = [...options.state.listExpanded()].sort();
        return {
          content: [
            "Deferred catalog (not expanded — pass a keyword query to expand):",
            catalog,
            already.length > 0
              ? `Already expanded: ${already.join(", ")}.`
              : "Already expanded: (none).",
          ].join("\n"),
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
              : `No deferred tools matched ${JSON.stringify(query)}. Tip: query \`list\` to browse the catalog.`,
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
