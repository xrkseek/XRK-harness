import type { MessageContent } from "./content.js";

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
   * Opaque presentation payload (DSH `output.presentationMeta`).
   * Log-only for Face `viewFor` replay; not model-visible.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
}
