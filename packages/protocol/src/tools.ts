export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface ToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
  /**
   * Opaque presentation payload (DSH `output.presentationMeta`).
   * Log-only for Face `viewFor` replay; not model-visible.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
}
