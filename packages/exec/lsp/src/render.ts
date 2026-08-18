import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { GenericCallView, GenericResultView } from "@xrkseek/core-tools";
import {
  LSP_OPERATIONS,
  type LspHover,
  type LspLocation,
  type LspOperation,
  type LspPosition,
} from "./types.js";

export const DEFAULT_MAX_LOCATIONS = 100;
export const DEFAULT_MAX_RESULT_CHARS = 16_000;
export const DEFAULT_LSP_TOOL_TIMEOUT_MS = 60_000;

export interface LspToolInput {
  readonly operation: LspOperation;
  readonly filePath: string;
  readonly position: LspPosition;
}

export interface LspToolArgs {
  readonly operation: string;
  readonly file_path: string;
  readonly line: number;
  readonly character: number;
}

export function parseLspArgs(args: LspToolArgs): LspToolInput {
  if (!isOperation(args.operation)) {
    throw new Error(`operation must be one of ${LSP_OPERATIONS.join(", ")}`);
  }
  if (args.file_path.trim().length === 0) {
    throw new Error("file_path must be a non-empty string");
  }
  const line = oneBased(args.line, "line");
  const character = oneBased(args.character, "character");
  return {
    operation: args.operation,
    filePath: args.file_path,
    position: { line: line - 1, character: character - 1 },
  };
}

function isOperation(value: string): value is LspOperation {
  return (LSP_OPERATIONS as readonly string[]).includes(value);
}

function oneBased(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (one-based)`);
  }
  return value;
}

export function formatLocations(
  locations: readonly LspLocation[],
  workspaceUri: string,
  maxLocations: number,
  maxResultChars: number,
): string {
  if (locations.length === 0) return boundResult("No results.", maxResultChars, "locations");
  const shown = locations.slice(0, maxLocations);
  const omitted = locations.length - shown.length;
  const grouped = new Map<string, string[]>();
  for (const location of shown) {
    const path = renderUri(location.uri, workspaceUri);
    const line = location.range.start.line + 1;
    const character = location.range.start.character + 1;
    const entries = grouped.get(path) ?? [];
    entries.push(`${path}:${line}:${character}`);
    grouped.set(path, entries);
  }
  const lines: string[] = [];
  for (const entries of grouped.values()) lines.push(...entries);
  if (omitted > 0) {
    lines.push(
      `… ${omitted} more location${omitted === 1 ? "" : "s"} omitted (limit ${maxLocations}).`,
    );
  }
  return boundResult(lines.join("\n"), maxResultChars, "locations");
}

export function formatHover(
  hover: LspHover | null,
  maxResultChars: number,
): string {
  const text = hover === null ? "No hover information." : hover.contents;
  return boundResult(text, maxResultChars, "hover");
}

function boundResult(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const notice = `\n… ${label} truncated (limit ${maxChars} characters).`;
  if (notice.length >= maxChars) return notice.slice(0, maxChars);
  return `${text.slice(0, maxChars - notice.length)}${notice}`;
}

export function renderUri(uri: string, workspaceUri: string): string {
  if (!uri.startsWith("file:")) return uri;
  let target: URL;
  let workspace: URL;
  try {
    target = new URL(uri);
    workspace = new URL(workspaceUri);
  } catch {
    return uri;
  }
  if (workspace.protocol !== "file:") return uri;
  const drivePath = /^\/[a-z](?::|%3A)/iu;
  const windowsWorld =
    workspace.hostname.length > 0 || drivePath.test(workspace.pathname);
  const targetWindowsWorld =
    windowsWorld &&
    (target.hostname.length > 0 || drivePath.test(target.pathname));
  const workspacePath = filePath(workspace, windowsWorld);
  const targetPath = filePath(target, targetWindowsWorld);
  if (workspacePath === undefined || targetPath === undefined) return uri;
  if (windowsWorld !== targetWindowsWorld) return targetPath;
  const path = windowsWorld ? win32 : posix;
  const relative = path.relative(workspacePath, targetPath);
  const outside =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  const rendered = relative === "" ? "." : outside ? targetPath : relative;
  return windowsWorld ? rendered.replaceAll("\\", "/") : rendered;
}

function filePath(url: URL, windows: boolean): string | undefined {
  try {
    const path = fileURLToPath(url, { windows });
    return path.includes("\0") ? undefined : path;
  } catch {
    return undefined;
  }
}

export function presentLspCall(args: LspToolArgs): GenericCallView {
  return {
    card: "generic",
    kind: "search",
    title: `LSP ${args.operation} ${args.file_path}:${args.line}:${args.character}`,
    locations: [{ path: args.file_path, line: args.line }],
  };
}

export function presentLspResult(
  _args: LspToolArgs,
  result: { readonly content: string },
): GenericResultView {
  return {
    card: "generic",
    content: [{ type: "text", text: result.content }],
  };
}

export const LSP_PROMPT_TEXT =
  "Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references. Positions are one-based line and character (UTF-16) at the cursor; an off-symbol position may return no results. findReferences always includes the declaration.";
