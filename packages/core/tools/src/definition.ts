import type { ToolResult } from "@xrkseek/protocol";
import type { MessageContent } from "@xrkseek/protocol";
import type {
  PresentableToolResult,
  ToolCallView,
  ToolResultView,
} from "./presentation.js";

/** Optional execute extras — pipeline wires session side-effects. */
export interface ToolExecuteExtras {
  emitToolEvent(type: string, payload: unknown): void;
  /**
   * Mark a successful final result as terminal for the current agent turn
   * (DSH `ToolRunContext.concludeTurn`). Equivalent to returning
   * `{ concludesTurn: true }`; ignored when the result is an error.
   */
  concludeTurn(): void;
  /**
   * Defer a user-visible context string until after this tool's `tool/result`
   * (DSH `deferContext`, string form — XRK appends `user/message`).
   */
  deferContext(text: string): void;
}

export interface ToolDefinition<TArgs = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(
    args: TArgs,
    signal?: AbortSignal,
    extras?: ToolExecuteExtras,
  ): Promise<ToolResultContent>;
  /**
   * Per-call concurrency classifier (DSH `isConcurrencySafe`).
   * Exact `true` may run overlapping with other safe calls; undeclared,
   * throwing, or any other return → exclusive barrier.
   */
  isConcurrencySafe?(args: TArgs): boolean;
  /**
   * Pure UI render intent. Soft-fail (return undefined / never throw) — Face
   * `viewFor` catches throws the same way DSH apiproxy does.
   */
  presentCall?(args: TArgs): ToolCallView | undefined;
  presentResult?(
    args: TArgs | undefined,
    result: PresentableToolResult,
  ): ToolResultView | undefined;
}

export interface ToolResultContent {
  readonly content: MessageContent;
  readonly isError?: boolean;
  /** Face presentation replay; copied onto session `tool/result`. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /**
   * DSH `ToolExecutionSuccess.concludesTurn`: successful body may end the
   * current agent turn after this step settles (no further LLM step).
   * Ignored when `isError` is set.
   */
  readonly concludesTurn?: true;
  /**
   * Structured failure class (e.g. abort codes). Copied onto session
   * `tool/result.error` by {@link normalizeToolResult}.
   */
  readonly error?: {
    readonly name: string;
    readonly code: string;
  };
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  /** Overwrite existing registration (new object identity → stale vs prior materialize). */
  replace(tool: ToolDefinition): void;
  unregister(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();
  return {
    register(tool) {
      if (tools.has(tool.name)) {
        throw new Error(`tool already registered: ${tool.name}`);
      }
      tools.set(tool.name, tool);
    },
    get(name) {
      return tools.get(name);
    },
    list() {
      return [...tools.values()];
    },
    /** Replace an existing tool (hot-reload / tests). Same name, new instance → materialize stale. */
    replace(tool) {
      if (!tools.has(tool.name)) {
        throw new Error(`tool not registered: ${tool.name}`);
      }
      tools.set(tool.name, tool);
    },
    unregister(name) {
      return tools.delete(name);
    },
  };
}

export function normalizeToolResult(
  callId: string,
  name: string,
  out: ToolResultContent,
): ToolResult {
  return {
    toolCallId: callId,
    name,
    content: out.content,
    ...(out.isError ? { isError: true as const } : {}),
    ...(out.meta !== undefined ? { meta: out.meta } : {}),
    ...(out.error !== undefined ? { error: out.error } : {}),
  };
}

export function errorToolResult(
  callId: string,
  name: string,
  content: string,
): ToolResult {
  return {
    toolCallId: callId,
    name,
    content,
    isError: true,
  };
}

/** Freeze result outcome; further mutation throws. */
export function freezeToolResult(result: ToolResult): ToolResult {
  return Object.freeze({ ...result });
}
