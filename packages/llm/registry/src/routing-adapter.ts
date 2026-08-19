/**
 * Session-scoped routing LLM (DSH `installModelSelection` + per-step resolve).
 * Resolves the inner adapter on every call from live selection — no agent invalidate on switch.
 */
import type {
  LlmAdapter,
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamEvent,
} from "@xrkseek/llm";
import type { LlmRequestConfig } from "@xrkseek/protocol";

export interface LlmRouteSelection {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

export interface RoutingLlmAdapter extends LlmAdapter {
  /** Resolve selection now (no provider I/O) for request/header logging. */
  ensureRoute(): LlmRequestConfig;
  /** Current route resolved for the latest call. */
  peekRoute(): LlmRequestConfig | undefined;
}

export interface CreateRoutingLlmAdapterOptions {
  readonly id: string;
  readonly getSelection: () => LlmRouteSelection | undefined;
  readonly resolveAdapter: (selection: LlmRouteSelection) => LlmAdapter;
  readonly inputModalities?: readonly ("text" | "image")[];
}

export function isRoutingLlmAdapter(
  llm: LlmAdapter,
): llm is RoutingLlmAdapter {
  return typeof (llm as RoutingLlmAdapter).peekRoute === "function";
}

export function createRoutingLlmAdapter(
  options: CreateRoutingLlmAdapterOptions,
): RoutingLlmAdapter {
  let lastRoute: LlmRequestConfig | undefined;

  const resolveInner = (): LlmAdapter => {
    const selection = options.getSelection();
    if (!selection) {
      throw new Error("routing-llm: no model selection configured");
    }
    lastRoute = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    };
    return options.resolveAdapter(selection);
  };

  const adapter: RoutingLlmAdapter = {
    id: options.id,
    ...(options.inputModalities !== undefined
      ? { inputModalities: options.inputModalities }
      : {}),
    peekRoute() {
      return lastRoute;
    },
    ensureRoute() {
      resolveInner();
      return lastRoute!;
    },
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      return resolveInner().chat(request);
    },
    stream: async function* (
      request: LlmChatRequest,
    ): AsyncIterable<LlmStreamEvent> {
      const inner = resolveInner();
      if (inner.stream) {
        yield* inner.stream(request);
        return;
      }
      const response = await inner.chat(request);
      yield {
        type: "done",
        content: response.content,
        ...(response.reasoning?.trim() ? { reasoning: response.reasoning } : {}),
        ...(response.toolCalls ? { toolCalls: response.toolCalls } : {}),
      };
    },
  };

  return adapter;
}
