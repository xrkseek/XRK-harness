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

/**
 * Localized ask prompt for the approval card (DSH `displayReason`).
 * Audit / session `approval/asked.reason` stays English; UI picks by locale.
 */
export type ApprovalDisplayReason = {
  readonly en: string;
  readonly [locale: string]: string;
};

export type PreOutcome =
  | { readonly action: "continue"; readonly args: unknown }
  | {
      readonly action: "deny";
      readonly reason: string;
      readonly error?: {
        readonly name: string;
        readonly code: string;
        readonly reason?: string;
      };
    }
  | {
      readonly action: "ask";
      /** English audit / deny reason (session log + model-facing deny). */
      readonly reason: string;
      /** Localized UI prompt; omitted → shell falls back to {@link reason}. */
      readonly displayReason?: ApprovalDisplayReason;
      /** Applied to the tool result when the ask is rejected. */
      readonly error?: {
        readonly name: string;
        readonly code: string;
        readonly reason?: string;
      };
    }
  | {
      /**
       * DSH Guardian `next()` before ask: keep running later pre handlers;
       * only ask if they all continue (downstream deny/ask/cancel wins).
       */
      readonly action: "defer-ask";
      /** English audit reason (same contract as {@link action} `ask`). */
      readonly reason: string;
      readonly displayReason?: ApprovalDisplayReason;
      readonly error?: {
        readonly name: string;
        readonly code: string;
        readonly reason?: string;
      };
    };

export type PostOutcome =
  | { readonly action: "accept" }
  | { readonly action: "block"; readonly reason: string }
  | {
      readonly action: "replace";
      readonly content: import("@xrkseek/protocol").MessageContent;
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
  /**
   * When set, this call is a Code Mode / PTC nested dispatch under an outer
   * `run_code` (DSH `exec.parent`). Auto-review skips the outer transport and
   * stamps reviewer mode `ptc-inner` for nested tools.
   */
  readonly parentCallId?: string;
  /**
   * Pending tool schema when the registry resolved the call (auto-review /
   * presentation). Omitted for unknown tools.
   */
  readonly definition?: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
  stage: PipelineStage;
  skippedBody: boolean;
  denyReason?: string;
  /**
   * Structured deny class (e.g. `FS_NOT_OBSERVED`).
   * Copied onto `tool/result.error` when pre/guards deny.
   */
  denyError?: {
    readonly name: string;
    readonly code: string;
    readonly reason?: string;
  };
  readonly additionalContexts: string[];
  /** Typed safety notices → session `safety/notice` (not opaque user/message). */
  readonly safetyNotices: SafetyNoticePayload[];
  readonly metrics: ToolMetrics;
  /** Tool-owned side events (todo/write etc.) — reserved. */
  readonly toolEvents: { type: string; payload: unknown }[];
  result?: ToolResultContent;
  /** Set by {@link ToolExecuteExtras.concludeTurn} during body. */
  concludeRequested?: boolean;
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
  (
    ctx: ToolPipelineContext,
  ):
    | import("@xrkseek/protocol").MessageContent
    | Promise<import("@xrkseek/protocol").MessageContent>;
}

export interface ApprovalHandler {
  (
    ctx: ToolPipelineContext,
    reason: string,
    displayReason?: ApprovalDisplayReason,
  ): boolean | Promise<boolean>;
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
  /** Tool-owned side events (e.g. todo/write) for the agent loop to append. */
  readonly toolEvents: readonly { type: string; payload: unknown }[];
  readonly stages: readonly PipelineStage[];
  readonly skippedBody: boolean;
  /** Set when model-facing content was truncated by output bound. */
  readonly truncated?: boolean;
  /** Managed full-output paths when persist was used. */
  readonly outputPaths?: readonly string[];
  /**
   * DSH: successful tool asked to end the turn after this step.
   * Failures / abort synthetics never set this.
   */
  readonly concludesTurn?: true;
}

export interface ToolPipeline {
  onPre(handler: PreHandler): () => void;
  /**
   * Register a pre handler ahead of later {@link onPre} registrations
   * (after the pipeline identity continue). DSH Guardian `prepend: true`.
   *
   * **Auto-review order lock:** composition installs Guardian / auto-review
   * here so it always runs before soft floors (`onPre`: hardline, policy,
   * read-only, hooks). Soft handlers must keep using {@link onPre}.
   */
  prependPre(handler: PreHandler): () => void;
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
    options: {
      timeoutMs?: number;
      maxRetries?: number;
      /** Nested Code Mode / PTC dispatch parent (outer `run_code` call id). */
      parentCallId?: string;
    },
  ): Promise<RunToolOutcome>;
}
