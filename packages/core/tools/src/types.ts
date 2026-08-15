import type {
  SafetyNoticePayload,
  ToolCall,
  ToolResult,
} from "@xrkseek/protocol";
import type { ToolDefinition, ToolResultContent } from "./definition.js";

export type { SafetyNoticePayload };

export type PipelineStage =
  | "pre"
  | "guards"
  | "execute"
  | "post"
  | "finalize"
  | "bound"
  | "result"
  | "batch-contexts";

export type GuardVerdict = "allow" | "deny" | "abstain";

export type PreOutcome =
  | { readonly action: "continue"; readonly args: unknown }
  | { readonly action: "deny"; readonly reason: string }
  | { readonly action: "ask"; readonly reason: string };

export type PostOutcome =
  | { readonly action: "accept" }
  | { readonly action: "block"; readonly reason: string }
  | {
      readonly action: "replace";
      readonly content: string;
      readonly isError?: boolean;
    };

export interface ToolMetrics {
  calls: number;
  retries: number;
}

export interface ToolPipelineContext {
  readonly call: ToolCall;
  args: unknown;
  readonly signal?: AbortSignal;
  stage: PipelineStage;
  skippedBody: boolean;
  denyReason?: string;
  readonly additionalContexts: string[];
  /** Typed safety notices → session `safety/notice` (not opaque user/message). */
  readonly safetyNotices: SafetyNoticePayload[];
  readonly metrics: ToolMetrics;
  /** Tool-owned side events (todo/write etc.) — reserved. */
  readonly toolEvents: { type: string; payload: unknown }[];
  result?: ToolResultContent;
}

export interface PreHandler {
  (ctx: ToolPipelineContext): PreOutcome | Promise<PreOutcome>;
}

export interface MonotonicGuard {
  (ctx: ToolPipelineContext): GuardVerdict | Promise<GuardVerdict>;
}

export interface ExecuteAroundHandler {
  (
    ctx: ToolPipelineContext,
    next: () => Promise<void>,
  ): Promise<void>;
}

export interface PostHandler {
  (ctx: ToolPipelineContext): PostOutcome | Promise<PostOutcome>;
}

export interface FinalizeHandler {
  (ctx: ToolPipelineContext): string | Promise<string>;
}

export interface ApprovalHandler {
  (ctx: ToolPipelineContext, reason: string): boolean | Promise<boolean>;
}

export interface TransientError extends Error {
  readonly transient: true;
}

export function isTransientError(err: unknown): err is TransientError {
  return (
    err instanceof Error &&
    "transient" in err &&
    (err as TransientError).transient === true
  );
}

export function transientError(message: string): TransientError {
  const err = new Error(message) as TransientError;
  Object.defineProperty(err, "transient", { value: true });
  return err;
}

export interface RunToolOptions {
  readonly registry: import("./definition.js").ToolRegistry;
  readonly call: ToolCall;
  readonly signal?: AbortSignal;
  readonly pipeline?: ToolPipeline;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface RunToolOutcome {
  readonly result: ToolResult;
  readonly additionalContexts: readonly string[];
  readonly safetyNotices: readonly SafetyNoticePayload[];
  readonly stages: readonly PipelineStage[];
  readonly skippedBody: boolean;
  /** Set when model-facing content was truncated by output bound. */
  readonly truncated?: boolean;
  /** Managed full-output paths when persist was used. */
  readonly outputPaths?: readonly string[];
}

export interface ToolPipeline {
  onPre(handler: PreHandler): () => void;
  onGuard(guard: MonotonicGuard): () => void;
  onExecute(handler: ExecuteAroundHandler): () => void;
  onPost(handler: PostHandler): () => void;
  onFinalize(handler: FinalizeHandler): () => void;
  setApprovalHandler(handler: ApprovalHandler | undefined): void;
  /** Internal: run one call through the full waterfall. */
  run(
    tool: ToolDefinition | undefined,
    call: ToolCall,
    signal: AbortSignal | undefined,
    options: { timeoutMs?: number; maxRetries?: number },
  ): Promise<RunToolOutcome>;
}
