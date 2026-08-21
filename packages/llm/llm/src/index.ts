import type {
  ChatMessage,
  LlmRequestConfig,
  ToolCall,
  TokenUsage,
} from "@xrkseek/protocol";

export interface LlmChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  readonly signal?: AbortSignal;
  /**
   * Resolve image attachment bytes for multimodal user content.
   * Required when messages contain image blocks.
   */
  readonly resolveImage?: (
    attachmentId: string,
  ) => Promise<{ readonly mediaType: string; readonly data: Uint8Array }>;
  /**
   * DeepSeek-style reasoning effort (`off` | `low` | `high` | `max`).
   * Adapters that understand thinking mode map this to wire fields; others ignore.
   */
  readonly reasoningEffort?: string;
}

/**
 * Why a successful provider call stopped (DSH `FinishReason` subset).
 * `max-tokens` — output ceiling; tool calls are unsafe (BlockAssembler keep/drop).
 * `error` — unknown wire stop (`content_filter`, …) with {@link LlmChatResponse.finishError}.
 */
export type LlmFinishReason = "stop" | "tool-calls" | "max-tokens" | "error";

export interface LlmChatResponse {
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  /** Optional model reasoning / thinking text when the vendor exposes it. */
  readonly reasoning?: string;
  /** Optional provider token sample when the vendor reports usage. */
  readonly usage?: TokenUsage;
  /** Present when the vendor reports a terminal stop reason. */
  readonly finishReason?: LlmFinishReason;
  /** Set when {@link finishReason} is `error` (DSH unknown finish_reason). */
  readonly finishError?: { readonly code: string; readonly message: string };
}

/** Streaming events from OpenAI-compatible SSE (text + reasoning + tool-call). */
export type LlmStreamEvent =
  | {
      readonly type: "text-delta";
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly type: "reasoning-delta";
      readonly index: number;
      readonly text: string;
    }
  | {
      /** Mid-stream tool-call argument fragment (DSH tool-call-delta). */
      readonly type: "tool-call-delta";
      readonly index: number;
      readonly id: string;
      readonly name?: string;
      readonly argumentsDelta: string;
    }
  | {
      /** Mid-stream provider usage sample (DSH StreamChunk usage). */
      readonly type: "usage";
      readonly usage: TokenUsage;
    }
  | {
      readonly type: "done";
      readonly content: string;
      readonly reasoning?: string;
      readonly toolCalls?: readonly ToolCall[];
      readonly usage?: TokenUsage;
      readonly finishReason?: LlmFinishReason;
      readonly finishError?: { readonly code: string; readonly message: string };
    };

/**
 * Map OpenAI Chat Completions `finish_reason` onto a response (DSH
 * `llm-deepseek/translate.mapFinishReason`).
 */
export function withOpenAiFinishReason(
  response: LlmChatResponse,
  raw: unknown,
): LlmChatResponse {
  if (raw === "length") return { ...response, finishReason: "max-tokens" };
  if (raw === "tool_calls") return { ...response, finishReason: "tool-calls" };
  if (raw === "stop") return { ...response, finishReason: "stop" };
  if (typeof raw === "string" && raw.trim()) {
    return {
      ...response,
      finishReason: "error",
      finishError: {
        code: raw.toUpperCase(),
        message: `model stopped: ${raw}`,
      },
    };
  }
  return response;
}

/** Map Anthropic Messages `stop_reason` onto a response. */
export function withAnthropicStopReason(
  response: LlmChatResponse,
  raw: unknown,
): LlmChatResponse {
  if (raw === "max_tokens") return { ...response, finishReason: "max-tokens" };
  if (raw === "tool_use") return { ...response, finishReason: "tool-calls" };
  if (raw === "end_turn" || raw === "stop_sequence") {
    return { ...response, finishReason: "stop" };
  }
  if (typeof raw === "string" && raw.trim()) {
    return {
      ...response,
      finishReason: "error",
      finishError: {
        code: raw.toUpperCase(),
        message: `model stopped: ${raw}`,
      },
    };
  }
  return response;
}

/** @deprecated Prefer {@link withOpenAiFinishReason}. */
export function mapOpenAiFinishReason(
  raw: unknown,
): Exclude<LlmFinishReason, "error"> | undefined {
  if (raw === "length") return "max-tokens";
  if (raw === "tool_calls") return "tool-calls";
  if (raw === "stop") return "stop";
  return undefined;
}

/** @deprecated Prefer {@link withAnthropicStopReason}. */
export function mapAnthropicStopReason(
  raw: unknown,
): Exclude<LlmFinishReason, "error"> | undefined {
  if (raw === "max_tokens") return "max-tokens";
  if (raw === "tool_use") return "tool-calls";
  if (raw === "end_turn" || raw === "stop_sequence") return "stop";
  return undefined;
}

/**
 * DSH BlockAssembler keep/drop: a `max-tokens` finish drops tool calls that
 * may be truncated.
 */
export function applyMaxTokensKeepDrop(
  response: LlmChatResponse,
): LlmChatResponse {
  if (response.finishReason !== "max-tokens" || !response.toolCalls?.length) {
    return response;
  }
  return {
    content: response.content,
    ...(response.reasoning ? { reasoning: response.reasoning } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
    finishReason: "max-tokens",
  };
}

/** True when parseArguments stored unparseable JSON as `{ _raw }`. */
export function toolCallArgsIncomplete(args: unknown): boolean {
  return (
    !!args &&
    typeof args === "object" &&
    !Array.isArray(args) &&
    Object.keys(args).length === 1 &&
    typeof (args as { _raw?: unknown })._raw === "string"
  );
}

/**
 * Post-provider gate (DSH translate + BlockAssembler): keep/drop, refuse
 * unknown finishes / empty stops / truncated tool JSON outside max-tokens.
 */
export function finalizeLlmChatResponse(
  response: LlmChatResponse,
): LlmChatResponse {
  const dropped = applyMaxTokensKeepDrop(response);
  if (dropped.finishReason === "error") {
    throw new ProviderFinishError(
      dropped.finishError?.message ?? "model stopped with an error finish",
      dropped.finishError?.code ?? "FINISH_ERROR",
    );
  }
  if (
    dropped.toolCalls?.some((c) => toolCallArgsIncomplete(c.arguments)) &&
    dropped.finishReason !== "max-tokens"
  ) {
    throw new IncompleteToolCallError(
      "tool call arguments were truncated or invalid JSON",
    );
  }
  const empty =
    !dropped.content.trim() &&
    !dropped.reasoning?.trim() &&
    !(dropped.toolCalls && dropped.toolCalls.length > 0);
  // max-tokens may leave a usage-only durable row; do not treat as EMPTY_RESPONSE.
  if (
    empty &&
    (dropped.finishReason === "stop" || dropped.finishReason === undefined)
  ) {
    throw new EmptyResponseError();
  }
  return dropped;
}

export interface LlmAdapter {
  readonly id: string;
  /** Declared input modalities; default text-only. */
  readonly inputModalities?: readonly ("text" | "image")[];
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
  /**
   * Optional SSE / incremental stream. When present, agent-loop prefers this
   * and appends `assistant/chunk` events before `assistant/message`.
   */
  stream?(request: LlmChatRequest): AsyncIterable<LlmStreamEvent>;
  /**
   * Optional on routing adapters (`@xrkseek/llm-registry`): live route for
   * `request/header` logging without provider I/O.
   */
  peekRoute?(): LlmRequestConfig | undefined;
  /** Prefer over {@link peekRoute} when present — resolves selection now. */
  ensureRoute?(): LlmRequestConfig;
}

/** Provider reported context window / token limit exceeded. */
export class ContextOverflowError extends Error {
  constructor(message = "context overflow") {
    super(message);
    this.name = "ContextOverflowError";
  }
}

export function isContextOverflowError(err: unknown): boolean {
  return err instanceof ContextOverflowError;
}

/** Content block modality not supported by the active adapter/route. */
export class UnsupportedContentError extends Error {
  readonly code = "UNSUPPORTED_CONTENT";
  constructor(message = "unsupported content") {
    super(message);
    this.name = "UnsupportedContentError";
  }
}

export function isUnsupportedContentError(err: unknown): boolean {
  return err instanceof UnsupportedContentError;
}

/** DSH EMPTY_RESPONSE: stop with no text, reasoning, or tool calls. */
export class EmptyResponseError extends Error {
  readonly code = "EMPTY_RESPONSE";
  constructor(message = "empty model response") {
    super(message);
    this.name = "EmptyResponseError";
  }
}

export function isEmptyResponseError(err: unknown): boolean {
  return err instanceof EmptyResponseError;
}

/** Unknown / filtered finish_reason (DSH finish kind error). */
export class ProviderFinishError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ProviderFinishError";
    this.code = code;
  }
}

export function isProviderFinishError(err: unknown): boolean {
  return err instanceof ProviderFinishError;
}

/** Tool-call JSON truncated when finish was not max-tokens. */
export class IncompleteToolCallError extends Error {
  readonly code = "INCOMPLETE_TOOL_CALL";
  constructor(message = "incomplete tool call") {
    super(message);
    this.name = "IncompleteToolCallError";
  }
}

export function isIncompleteToolCallError(err: unknown): boolean {
  return err instanceof IncompleteToolCallError;
}

/** Unsupported or deployment-locked reasoning effort (DSH UNSUPPORTED_REASONING_EFFORT). */
export class UnsupportedReasoningEffortError extends Error {
  readonly code = "UNSUPPORTED_REASONING_EFFORT";
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedReasoningEffortError";
  }
}

export function isUnsupportedReasoningEffortError(err: unknown): boolean {
  return err instanceof UnsupportedReasoningEffortError;
}

export {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  QUOTA_EXCEEDED_CODE,
  LlmError,
  classifyCaughtLlmError,
  httpErrorCode,
  isLlmError,
  isQuotaExceededError,
  parseRetryAfterMs,
  requestIdFromHeaders,
  throwHttpLlmError,
  type LlmFailure,
} from "./failure.js";

export {
  DEFAULT_RETRY_POLICY,
  DEFAULT_RETRYABLE_CODES,
  cancellableDelay,
  computeRetryDelayMs,
  failureFromUnknown,
  isRetryableFailure,
  type ResolvedRetryPolicy,
  type RetryPolicyMode,
} from "./retry-policy.js";


export interface LlmRegistry {
  register(adapter: LlmAdapter): void;
  get(id: string): LlmAdapter;
  list(): readonly LlmAdapter[];
}

export function createLlmRegistry(): LlmRegistry {
  const adapters = new Map<string, LlmAdapter>();
  return {
    register(adapter) {
      if (adapters.has(adapter.id)) {
        throw new Error(`llm adapter already registered: ${adapter.id}`);
      }
      adapters.set(adapter.id, adapter);
    },
    get(id) {
      const a = adapters.get(id);
      if (!a) throw new Error(`llm adapter not found: ${id}`);
      return a;
    },
    list() {
      return [...adapters.values()];
    },
  };
}

/** Collect a stream into a chat response (also used by chat wrappers). */
export async function collectLlmStream(
  stream: AsyncIterable<LlmStreamEvent>,
): Promise<LlmChatResponse> {
  let content = "";
  let reasoning = "";
  let toolCalls: readonly ToolCall[] | undefined;
  let usage: LlmChatResponse["usage"];
  let finishReason: LlmFinishReason | undefined;
  let finishError: LlmChatResponse["finishError"];
  for await (const ev of stream) {
    if (ev.type === "text-delta") content += ev.text;
    else if (ev.type === "reasoning-delta") reasoning += ev.text;
    else if (ev.type === "usage") usage = ev.usage;
    else if (ev.type === "done") {
      content = ev.content || content;
      if (ev.reasoning) reasoning = ev.reasoning;
      if (ev.toolCalls) toolCalls = ev.toolCalls;
      if (ev.usage) usage = ev.usage;
      if (ev.finishReason) finishReason = ev.finishReason;
      if (ev.finishError) finishError = ev.finishError;
    }
  }
  return finalizeLlmChatResponse({
    content,
    ...(reasoning.trim() ? { reasoning } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(finishError ? { finishError } : {}),
  });
}
