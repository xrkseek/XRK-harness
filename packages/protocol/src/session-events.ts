import type { ToolCall, ToolResult } from "./tools.js";
import type { MessageContent } from "./content.js";
import type { TokenUsage } from "./token-usage.js";

/** Append-only session facts (M0 minimal set). */

export interface SessionEventBase {
  readonly type: string;
  readonly ts: number;
}

export interface TurnStartEvent extends SessionEventBase {
  readonly type: "turn/start";
  readonly turnId: string;
}

/** Live cancel source (DSH `AgentCancelCause`). */
export type AgentCancelCause =
  | { readonly kind: "user" }
  | { readonly kind: "parent" }
  | { readonly kind: "hook"; readonly reason: string }
  | { readonly kind: "disposed" };

/**
 * Durable cancel cause on `turn/end` (DSH `TurnEndCancelCause`).
 * `legacy` covers bare `AbortSignal` aborts without a typed reason.
 */
export type TurnEndCancelCause =
  | AgentCancelCause
  | { readonly kind: "legacy" };

/** Why a turn ended (DSH wire subset; merge-extensible at Face boundary). */
export type TurnEndReason =
  | { readonly kind: "completed" }
  | { readonly kind: "aborted"; readonly reason: TurnEndCancelCause }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "max-tokens" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "blocked" };

/** Coerce `AbortSignal.reason` / unknown into a durable cancel cause. */
export function parseTurnEndCancelCause(raw: unknown): TurnEndCancelCause {
  if (raw !== null && typeof raw === "object" && "kind" in raw) {
    const rec = raw as { kind?: unknown; reason?: unknown };
    const kind = rec.kind;
    if (
      kind === "user" ||
      kind === "parent" ||
      kind === "disposed" ||
      kind === "legacy"
    ) {
      return { kind };
    }
    if (kind === "hook" && typeof rec.reason === "string") {
      return { kind: "hook", reason: rec.reason };
    }
  }
  return { kind: "legacy" };
}

export interface TurnEndEvent extends SessionEventBase {
  readonly type: "turn/end";
  readonly turnId: string;
  readonly reason: TurnEndReason;
}

export interface StepStartEvent extends SessionEventBase {
  readonly type: "step/start";
  readonly turnId: string;
  readonly stepId: string;
}

export interface StepEndEvent extends SessionEventBase {
  readonly type: "step/end";
  readonly turnId: string;
  readonly stepId: string;
}

export interface UserMessageEvent extends SessionEventBase {
  readonly type: "user/message";
  readonly turnId: string;
  /** Plain string (legacy) or ContentBlock[] (text + image refs). */
  readonly content: MessageContent;
  /**
   * Face / client optimism id (echo of unary `rpcId` from `session.prompt`).
   * Ignored by `deriveMessages` — not model-visible.
   */
  readonly rpcId?: string;
}

export interface AssistantChunkEvent extends SessionEventBase {
  readonly type: "assistant/chunk";
  readonly turnId: string;
  readonly stepId: string;
  /**
   * Text / reasoning payload. Empty when `kind` is `"usage"`.
   * For `kind: "tool-call"`, mirrors {@link argumentsDelta} (pack/search convenience).
   */
  readonly text: string;
  /**
   * Default `"text"`. Reasoning uses a separate Face mux chunk type.
   * `"usage"` — provider token sample mid-stream.
   * `"tool-call"` — streamed tool-call argument fragment (DSH tool-call-delta).
   */
  readonly kind?: "text" | "reasoning" | "usage" | "tool-call";
  /** DSH StreamChunk index; reasoning=0 text=1; tool-call uses vendor tool index. */
  readonly index?: number;
  /** Present when `kind` is `"usage"` (also allowed on text chunks for soft forward-compat). */
  readonly usage?: TokenUsage;
  /** Required when `kind` is `"tool-call"`. */
  readonly toolCallId?: string;
  /** Optional tool name when first seen on the stream. */
  readonly toolName?: string;
  /** JSON arguments fragment when `kind` is `"tool-call"`. */
  readonly argumentsDelta?: string;
}

export interface AssistantMessageEvent extends SessionEventBase {
  readonly type: "assistant/message";
  readonly turnId: string;
  readonly stepId: string;
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  /** Optional thinking text when the model exposed reasoning (not model-visible history). */
  readonly reasoning?: string;
  /** User cancelled mid-stream; prefix was finalized from logged chunks (DSH rc.8). */
  readonly interrupted?: boolean;
  /** Provider token sample when the adapter reported usage (Face sessionStats). */
  readonly usage?: TokenUsage;
}

export interface ToolCallEvent extends SessionEventBase {
  readonly type: "tool/call";
  readonly turnId: string;
  readonly stepId: string;
  readonly call: ToolCall;
}

export interface ToolResultEvent extends SessionEventBase {
  readonly type: "tool/result";
  readonly turnId: string;
  readonly stepId: string;
  readonly result: ToolResult;
}

/** Pending user input — not model-visible until promoted + user/message. */
export type PromptDelivery = "steer" | "queue";

export function isPromptDelivery(value: unknown): value is PromptDelivery {
  return value === "steer" || value === "queue";
}

/**
 * Normalize optional client/API delivery.
 * - omit / null / "" → `undefined` (admit layer treats as queue)
 * - `"steer"` | `"queue"` → as-is
 * - anything else → `undefined` and sets `ok: false` via return discriminant
 */
export function parsePromptDelivery(
  value: unknown,
):
  | { readonly ok: true; readonly delivery: PromptDelivery | undefined }
  | { readonly ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, delivery: undefined };
  }
  if (isPromptDelivery(value)) {
    return { ok: true, delivery: value };
  }
  return { ok: false };
}

export interface PromptAdmittedEvent extends SessionEventBase {
  readonly type: "prompt/admitted";
  readonly admitId: string;
  readonly content: MessageContent;
  /**
   * Inbox delivery mode. Omitted ⇒ `"queue"` (FIFO; see docs/session-delivery.md).
   * `"steer"` = interrupt-at-turn-boundary (promote preferred over queue).
   */
  readonly delivery?: PromptDelivery;
}

/** Marks an admit as consumed into a turn (still not a chat message by itself). */
export interface PromptPromotedEvent extends SessionEventBase {
  readonly type: "prompt/promoted";
  readonly admitId: string;
}

/**
 * Withdraw a pending admit from the inbox (edit/remove/steer rewrite).
 * Log-only — never model-visible.
 */
export interface PromptWithdrawnEvent extends SessionEventBase {
  readonly type: "prompt/withdrawn";
  readonly admitId: string;
}

/**
 * System safety injection (loop / mistake). Durable & typed — unlike Cline's
 * opaque user-text notices. `deriveMessages` projects as `role: user` so the
 * model still sees it; hosts/UI filter by `type` / `kind`.
 */
export type SafetyNoticeKind =
  | "loop_soft"
  | "loop_hard"
  | "mistake_limit"
  | "api_error";

export interface SafetyNoticePayload {
  readonly kind: SafetyNoticeKind;
  readonly content: string;
  readonly toolName?: string;
  readonly count?: number;
}

export interface SafetyNoticeEvent
  extends SessionEventBase, SafetyNoticePayload {
  readonly type: "safety/notice";
  readonly turnId: string;
}

/**
 * Context compaction checkpoint. Log is never truncated — `deriveMessages`
 * starts the model window at the latest compaction (OpenCode-style).
 */
export type CompactionReason = "auto" | "overflow" | "manual";

export interface ContextCompactionEvent extends SessionEventBase {
  readonly type: "context/compaction";
  readonly turnId?: string;
  readonly reason: CompactionReason;
  /** Anchored summary (model-facing). */
  readonly summary: string;
  /** Verbatim recent tail kept outside the summarized head. */
  readonly recent: string;
  /**
   * Heuristic tokens of the surface window this compaction replaces
   * (DSH shadowedTokenCount). When omitted, Face meter folds at delta 0.
   */
  readonly shadowedTokenCount?: number;
}

/**
 * Log-only session title (UI / Face projections).
 * Never enters `deriveMessages` / model window.
 */
export type SessionTitleSource =
  | { readonly kind: "fallback" }
  | { readonly kind: "user" };

export interface SessionTitleEvent extends SessionEventBase {
  readonly type: "session/title";
  /** Normalized non-empty title. */
  readonly title: string;
  readonly source: SessionTitleSource;
  /** Face seqs of `user/message` used for fallback; empty for user rename. */
  readonly messageSeqs?: readonly number[];
}

/**
 * Tool pipeline requested human approval (`ask`).
 * Log-only — not model-visible; Face / Host rebuild pending UI from these.
 */
export type ApprovalDecisionSource = "user" | "cancel" | "timeout";

export interface ApprovalAskedEvent extends SessionEventBase {
  readonly type: "approval/asked";
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly reason: string;
  /** Optional truncated args preview (never secrets-bearing by convention). */
  readonly argsSummary?: string;
  readonly turnId?: string;
  readonly stepId?: string;
}

export interface ApprovalDecidedEvent extends SessionEventBase {
  readonly type: "approval/decided";
  readonly approvalId: string;
  readonly decision: "allow" | "deny";
  readonly source: ApprovalDecisionSource;
}

/**
 * Slash-command admission (Face `commands/execute`). Log-only — not
 * model-visible. Pair with `command/done` via `commandId`.
 */
export type CommandSource = { readonly kind: "user" };

export interface CommandRunEvent extends SessionEventBase {
  readonly type: "command/run";
  readonly commandId: string;
  readonly name: string;
  /** Verbatim text after the command name, including leading whitespace. */
  readonly args?: string;
  readonly source: CommandSource;
}

export interface CommandDoneEvent extends SessionEventBase {
  readonly type: "command/done";
  readonly commandId: string;
  readonly kind: "success" | "error";
  readonly text?: string;
  readonly sourceEventSeq?: number;
}

/** Standing plan snapshot (DSH `todo/write`); Face `todos` projection. */
export type TodoItemStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  readonly content: string;
  readonly status: TodoItemStatus;
}

export interface TodoWriteEvent extends SessionEventBase {
  readonly type: "todo/write";
  readonly todos: readonly TodoItem[];
}

/** DSH permission-presets knob — log-only; Face `permissions` projection. */
export type SandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type ApprovalPolicy = "ask" | "never";

export interface PermissionPresetEvent extends SessionEventBase {
  readonly type: "permission/preset";
  readonly preset: string;
}

export interface SandboxModeEvent extends SessionEventBase {
  readonly type: "sandbox/mode";
  readonly mode: SandboxMode;
}

export interface ApprovalPolicyEvent extends SessionEventBase {
  readonly type: "approval/policy";
  readonly policy: ApprovalPolicy;
}

/** DSH plan-mode — log-only; Face `plan` projection. Last one wins. */
export interface PlanModeEvent extends SessionEventBase {
  readonly type: "plan/mode";
  readonly active: boolean;
}

/** Human session remark (DSH `feedback/record`). Log-only; not model-visible. */
export interface FeedbackRecordEvent extends SessionEventBase {
  readonly type: "feedback/record";
  readonly text: string;
}

/** Per-conversation LLM route snapshot (DSH `LlmCallConfig` subset). */
export interface LlmRequestConfig {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  /** Provider-advertised context capacity when known (Face contextPressure). */
  readonly contextWindow?: number;
}

export type RequestHeaderReason = "initial" | "resume" | "change";

/** Tool schema row logged on `request/header` for Face contextBreakdown. */
export interface RequestHeaderToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** Non-history request envelope snapshot (DSH `request/header`). Not model-visible. */
export interface RequestHeaderEvent extends SessionEventBase {
  readonly type: "request/header";
  readonly turnId: string;
  readonly reason: RequestHeaderReason;
  readonly header: {
    readonly config: LlmRequestConfig;
    /** Assembled system prompt for this request (optional; Face estimate). */
    readonly system?: string;
    /** Standing tool schemas for this request (optional; Face estimate). */
    readonly tools?: readonly RequestHeaderToolSchema[];
    readonly adapterDefaults?: {
      readonly reasoningEffort?: boolean;
      readonly maxTokens?: boolean;
    };
  };
}

/** Durable record that a provider retry wait was scheduled (DSH llm/retry). */
export interface LlmRetryEvent extends SessionEventBase {
  readonly type: "llm/retry";
  readonly turnId: string;
  readonly stepId: string;
  readonly retryId: string;
  readonly retry: number;
  readonly maxRetries?: number;
  readonly delayMs: number;
  readonly mode: "normal" | "always";
  readonly failure: {
    readonly message: string;
    readonly code: string;
    readonly status?: number;
    readonly providerRetryAfterMs?: number;
  };
  readonly provider?: string;
}

/** Durable transition after a retry wait completed (DSH llm/retry-started). */
export interface LlmRetryStartedEvent extends SessionEventBase {
  readonly type: "llm/retry-started";
  readonly turnId: string;
  readonly stepId: string;
  readonly retryId: string;
  readonly retry: number;
}

export type SessionEvent =
  | TurnStartEvent
  | TurnEndEvent
  | StepStartEvent
  | StepEndEvent
  | UserMessageEvent
  | AssistantChunkEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | PromptAdmittedEvent
  | PromptPromotedEvent
  | PromptWithdrawnEvent
  | SafetyNoticeEvent
  | ContextCompactionEvent
  | SessionTitleEvent
  | ApprovalAskedEvent
  | ApprovalDecidedEvent
  | CommandRunEvent
  | CommandDoneEvent
  | TodoWriteEvent
  | PermissionPresetEvent
  | SandboxModeEvent
  | ApprovalPolicyEvent
  | PlanModeEvent
  | FeedbackRecordEvent
  | RequestHeaderEvent
  | LlmRetryEvent
  | LlmRetryStartedEvent;

const SESSION_EVENT_TYPES = new Set<SessionEvent["type"]>([
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "user/message",
  "assistant/chunk",
  "assistant/message",
  "tool/call",
  "tool/result",
  "prompt/admitted",
  "prompt/promoted",
  "prompt/withdrawn",
  "safety/notice",
  "context/compaction",
  "session/title",
  "approval/asked",
  "approval/decided",
  "command/run",
  "command/done",
  "todo/write",
  "permission/preset",
  "sandbox/mode",
  "approval/policy",
  "plan/mode",
  "feedback/record",
  "request/header",
  "llm/retry",
  "llm/retry-started",
]);

/**
 * Loose type gate (known `type` + numeric `ts`).
 * For I/O / JSONL import use `parseSessionEvent` / `isValidSessionEvent`.
 */
export function isSessionEvent(value: unknown): value is SessionEvent {
  if (value === null || typeof value !== "object") return false;
  const v = value as { type?: unknown; ts?: unknown };
  return (
    typeof v.type === "string" &&
    SESSION_EVENT_TYPES.has(v.type as SessionEvent["type"]) &&
    typeof v.ts === "number"
  );
}
