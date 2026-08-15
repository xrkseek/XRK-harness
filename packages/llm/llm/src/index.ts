import type { ChatMessage, ToolCall } from "@xrkseek/protocol";

export interface LlmChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  readonly signal?: AbortSignal;
}

export interface LlmChatResponse {
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface LlmAdapter {
  readonly id: string;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
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
