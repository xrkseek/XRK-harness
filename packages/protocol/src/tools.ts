import type { MessageContent } from "./content.js";

/** Cancel after tool body was invoked (DSH `ABORTED`). */
export const TOOL_ABORTED = "ABORTED";

/** Cancel prevented body dispatch (DSH `ABORTED_BEFORE_DISPATCH`). */
export const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";

export const TOOL_ABORTED_MESSAGE = "Error: tool call aborted";

export const TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE =
  "Error: tool call aborted before dispatch";

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface ToolResult {
  readonly toolCallId: string;
  readonly name: string;
  /**
   * Model-visible tool output. Plain string for text; `ContentBlock[]` when
   * MCP (or another producer) admitted durable image refs.
   */
  readonly content: MessageContent;
  readonly isError?: boolean;
  /**
   * Structured failure class for crash-repair / abort synthetic results
   * (`TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` / {@link TOOL_ABORTED_BEFORE_DISPATCH} /
   * {@link TOOL_ABORTED}). Model still reads {@link content}; Face may surface {@link error}.
   */
  readonly error?: {
    readonly name: string;
    readonly code: string;
  };
  /**
   * Opaque presentation payload (DSH `output.presentationMeta`).
   * Log-only for Face `viewFor` replay; not model-visible.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
}
