/**
 * Tool render-intent vocabulary — single source of truth: `@xrkseek/core-tools`.
 * This Cordis stub package re-exports so remotes stay on
 * `@xrkseek/xrk-tools/presentation` without a second FileDiff / card fork.
 */
export type {
  DiffCallView,
  DiffResultView,
  FileDiff,
  FileLocation,
  GenericCallView,
  GenericResultView,
  ParsedExitStatus,
  PresentableToolResult,
  ReadFileLine,
  ReadResultView,
  SearchFileMatches,
  SearchLineMatch,
  SearchMatchesResultView,
  SearchPathsResultView,
  TerminalCallView,
  TerminalResultView,
  TextBlock,
  ToolCallKind,
  ToolCallView,
  ToolEventView,
  ToolResultView,
  WebFetchResultView,
  WebResultView,
  WebSearchResultView,
  WebSource,
} from "@xrkseek/core-tools";

export { parseExitStatus } from "@xrkseek/core-tools";

/** Discriminated search result union (matches + paths). */
export type SearchResultView =
  | import("@xrkseek/core-tools").SearchMatchesResultView
  | import("@xrkseek/core-tools").SearchPathsResultView;
