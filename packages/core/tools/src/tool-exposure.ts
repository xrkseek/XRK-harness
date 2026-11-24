/**
 * Progressive tool disclosure — Codex tool_search / ToolExposure alignment.
 * Registry stays full; only the LLM wire catalog is filtered.
 */

import type {
  ToolDefinition,
  ToolExposure,
  ToolRegistry,
} from "./definition.js";
import { scoreFuzzyQuery } from "./fuzzy-match.js";

export const TOOL_SEARCH_NAME = "tool_search";
/** Codex `TOOL_SEARCH_DEFAULT_LIMIT`. */
export const TOOL_SEARCH_DEFAULT_LIMIT = 8;
/** Catalog fragment budget (Codex world_state tools ≈ 4KiB). */
export const TOOL_CATALOG_MAX_BYTES = 4 * 1024;
/** Browse list stays short — full schema comes after expand. */
const NS_DESC_MAX = 72;

/**
 * Standing Deferred packs (scientific bar — all of):
 * 1. Schema fat enough that hello-turns pay real rent (≥~300 tok).
 * 2. Rare on first turns / not on the peer-find or 主线 pin chain.
 * 3. Present on **most** seats (safe to hint in the stable `tool_search`
 *    description). Seat-only tools (向阳 `settings_*` / `workspace_*`) stay
 *    Direct where Face binds them — do **not** advertise them globally.
 *
 * Keep Direct (disclosure chain / high P(use)):
 * - fs/shell · skill/memory · ask/present/todo
 * - `team_list` · `team_home` · `team_save` (spawn/mint)
 * - `thread_*` (主线 pin + mail)
 * - `session_*` (find peers after a thin collab board)
 * - `web_*` (research seats hit early; expand tax ≈ keep Direct)
 * - `settings_*` / `workspace_*` (向阳-only; Face binds, not this list)
 *
 * browser_* / computer_use / MCP already set `exposure: deferred` at source.
 */
export const STANDING_DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_signal",
  "terminal_close",
  "terminal_list",
  "job_list",
  "job_output",
  "job_kill",
  "cronjob",
  "propose_skill",
]);

/**
 * Force listed Direct tools onto Deferred (idempotent; skips hidden / already
 * deferred). Call after preset registration and again after Face binds.
 */
export function applyStandingDeferredExposure(tools: ToolRegistry): void {
  for (const name of STANDING_DEFERRED_TOOL_NAMES) {
    const tool = tools.get(name);
    if (!tool) continue;
    if (exposureOf(tool) !== "direct") continue;
    tools.replace({ ...tool, exposure: "deferred" });
  }
}

export function exposureOf(tool: ToolDefinition): ToolExposure {
  return tool.exposure ?? "direct";
}

/**
 * LLM wire catalog.
 * - With `tool_search`: Direct + search (+ expanded Deferred).
 * - Without `tool_search`: Direct only — Deferred stays off the wire.
 *   (Fail-open used to treat Deferred as Direct and could dump 100k+ MCP
 *   schemas into every soft-budget estimate; product presets always register
 *   `tool_search` so expand still works.)
 */
export function listForModel(
  tools: readonly ToolDefinition[],
  options?: {
    readonly expandedNames?: ReadonlySet<string>;
  },
): ToolDefinition[] {
  const hasSearch = tools.some((t) => t.name === TOOL_SEARCH_NAME);
  const expanded = options?.expandedNames;

  if (!hasSearch) {
    return tools.filter((t) => {
      const e = exposureOf(t);
      return e !== "hidden" && e !== "deferred";
    });
  }

  return tools.filter((t) => {
    if (t.name === TOOL_SEARCH_NAME) return true;
    const e = exposureOf(t);
    if (e === "hidden") return false;
    if (e === "direct") return true;
    return expanded?.has(t.name) === true;
  });
}

/** Build searchable text: name (+ underscore→space) + description + schema keys. */
export function toolSearchText(tool: ToolDefinition): string {
  const parts: string[] = [
    tool.name,
    tool.name.replace(/_/g, " "),
    tool.description,
  ];
  appendSchemaSearchText(tool.parameters, parts, 0);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function appendSchemaSearchText(
  schema: unknown,
  parts: string[],
  depth: number,
): void {
  if (depth > 6 || !schema || typeof schema !== "object") return;
  const obj = schema as Record<string, unknown>;
  if (typeof obj.description === "string") parts.push(obj.description);
  const props = obj.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      parts.push(key.replace(/_/g, " "));
      appendSchemaSearchText(value, parts, depth + 1);
    }
  }
  const items = obj.items;
  if (items) appendSchemaSearchText(items, parts, depth + 1);
}

export function scoreToolSearch(
  query: string,
  searchText: string,
  name?: string,
): number {
  return scoreFuzzyQuery(query, searchText, name ? { name } : undefined);
}

export function searchDeferredTools(
  tools: readonly ToolDefinition[],
  query: string,
  options?: {
    readonly limit?: number;
    readonly excludeExpanded?: ReadonlySet<string>;
  },
): ToolDefinition[] {
  const limit = options?.limit ?? TOOL_SEARCH_DEFAULT_LIMIT;
  const exclude = options?.excludeExpanded;
  const scored: { tool: ToolDefinition; score: number }[] = [];
  for (const tool of tools) {
    if (tool.name === TOOL_SEARCH_NAME) continue;
    if (exposureOf(tool) !== "deferred") continue;
    if (exclude?.has(tool.name)) continue;
    const score = scoreToolSearch(query, toolSearchText(tool), tool.name);
    if (score > 0) scored.push({ tool, score });
  }
  scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return scored.slice(0, limit).map((s) => s.tool);
}

/** Short deferred catalog for tool_search description (≤ 4KiB). */
export function formatDeferredCatalog(
  tools: readonly ToolDefinition[],
  maxBytes = TOOL_CATALOG_MAX_BYTES,
): string {
  const deferred = tools
    .filter((t) => exposureOf(t) === "deferred" && t.name !== TOOL_SEARCH_NAME)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (deferred.length === 0) return "(no deferred tools)";

  const enc = new TextEncoder();
  const lines: string[] = [];
  let used = 0;
  const omitReserve = 64;
  for (const tool of deferred) {
    const desc = tool.description.replace(/\s+/g, " ").trim().slice(0, NS_DESC_MAX);
    const line = desc ? `${tool.name} — ${desc}` : tool.name;
    const next = used + enc.encode(line).length + 1;
    if (next > maxBytes - omitReserve && lines.length > 0) {
      lines.push(`… +${deferred.length - lines.length} more (tool_search)`);
      break;
    }
    lines.push(line);
    used = next;
  }
  return lines.join("\n");
}

export function countExposures(tools: readonly ToolDefinition[]): {
  readonly direct: number;
  readonly deferred: number;
  readonly hidden: number;
} {
  let direct = 0;
  let deferred = 0;
  let hidden = 0;
  for (const t of tools) {
    if (t.name === TOOL_SEARCH_NAME) {
      direct += 1;
      continue;
    }
    const e = exposureOf(t);
    if (e === "deferred") deferred += 1;
    else if (e === "hidden") hidden += 1;
    else direct += 1;
  }
  return { direct, deferred, hidden };
}
