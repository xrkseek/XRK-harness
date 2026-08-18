/**
 * Tool render-intent vocabulary (DSH `dsh-tools/presentation`).
 * Tools declare this via `presentCall` / `presentResult`; Face only looks up.
 */

export type ToolCallKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "fetch"
  | "other";

export interface FileLocation {
  readonly path: string;
  readonly line?: number;
}

export interface FileDiff {
  readonly path: string;
  readonly oldText: string | null;
  readonly newText: string;
}

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface GenericCallView {
  readonly card: "generic";
  readonly title: string;
  readonly kind?: ToolCallKind;
  readonly rawInput?: unknown;
  readonly content?: readonly TextBlock[];
  readonly locations?: readonly FileLocation[];
}

export interface TerminalCallView {
  readonly card: "terminal";
  readonly title: string;
  readonly description?: string;
  readonly cwd?: string;
}

export interface DiffCallView {
  readonly card: "diff";
  readonly title: string;
  readonly diffs: readonly FileDiff[];
  readonly locations?: readonly FileLocation[];
}

export type ToolCallView = GenericCallView | TerminalCallView | DiffCallView;

export interface GenericResultView {
  readonly card: "generic";
  readonly title?: string;
  readonly content?: readonly TextBlock[];
}

export interface TerminalResultView {
  readonly card: "terminal";
  readonly title?: string;
  readonly output?: string;
  readonly exitCode?: number;
  readonly signal?: string;
}

export interface DiffResultView {
  readonly card: "diff";
  readonly title?: string;
  readonly diffs: readonly FileDiff[];
}

export interface SearchLineMatch {
  readonly lineNumber: number;
  readonly line: string;
}

export interface SearchFileMatches {
  readonly path: string;
  readonly matches: readonly SearchLineMatch[];
}

export interface SearchMatchesResultView {
  readonly card: "search";
  readonly shape: "matches";
  readonly title?: string;
  readonly files: readonly SearchFileMatches[];
  readonly truncated: boolean;
  readonly total: number;
}

export interface SearchPathsResultView {
  readonly card: "search";
  readonly shape: "paths";
  readonly title?: string;
  readonly paths: readonly string[];
  readonly truncated: boolean;
  readonly total: number;
}

export interface ReadFileLine {
  readonly number: number;
  readonly text: string;
}

export interface ReadResultView {
  readonly card: "read";
  readonly title?: string;
  readonly path: string;
  readonly offset: number;
  readonly lines: readonly ReadFileLine[];
  readonly totalLines: number;
  readonly lang?: string;
  readonly content?: readonly TextBlock[];
}

export type ToolResultView =
  | GenericResultView
  | TerminalResultView
  | DiffResultView
  | SearchMatchesResultView
  | SearchPathsResultView
  | ReadResultView;

export type ToolEventView =
  | { readonly for: "call"; readonly view: ToolCallView }
  | { readonly for: "result"; readonly view: ToolResultView };

/** Shape presenters receive (XRK result content is a string, not ContentBlock[]). */
export interface PresentableToolResult {
  readonly content: string;
  readonly isError?: boolean;
}

export type ParsedExitStatus =
  | { readonly body: string; readonly exitCode: number }
  | { readonly body: string; readonly signal: string };

/**
 * Inverse of DSH shell render markers `[exit code: N]` / `[killed by signal: X]`.
 * Copied from `@deepseek-ai/dsh-shell` `parseExitStatus`.
 */
export function parseExitStatus(text: string): ParsedExitStatus {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text);
  if (signal?.[1] !== undefined) {
    return { body: text.slice(0, signal.index), signal: signal[1] };
  }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text);
  if (exit?.[1] !== undefined) {
    return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) };
  }
  return { body: text, exitCode: 0 };
}
