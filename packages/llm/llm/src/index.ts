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
}

export interface LlmChatResponse {
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  /** Optional model reasoning / thinking text when the vendor exposes it. */
  readonly reasoning?: string;
  /** Optional provider token sample when the vendor reports usage. */
  readonly usage?: TokenUsage;
}

/** Streaming events from OpenAI-compatible SSE (text + reasoning). */
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
    };

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
  for await (const ev of stream) {
    if (ev.type === "text-delta") content += ev.text;
    else if (ev.type === "reasoning-delta") reasoning += ev.text;
    else if (ev.type === "usage") usage = ev.usage;
    else if (ev.type === "done") {
      content = ev.content || content;
      if (ev.reasoning) reasoning = ev.reasoning;
      if (ev.toolCalls) toolCalls = ev.toolCalls;
      if (ev.usage) usage = ev.usage;
    }
  }
  return {
    content,
    ...(reasoning.trim() ? { reasoning } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
  };
}
