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
  readonly contextWindow?: number;
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
  /**
   * Optional static override. When omitted, `inputModalities` is read from the
   * current inner adapter (live route) so Host Face intake settings cannot
   * mask Registry text-only brands.
   */
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
      ...(selection.contextWindow !== undefined
        ? { contextWindow: selection.contextWindow }
        : {}),
    };
    return options.resolveAdapter(selection);
  };

  const adapter: RoutingLlmAdapter = {
    id: options.id,
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
        ...(response.usage ? { usage: response.usage } : {}),
      };
    },
  };

  Object.defineProperty(adapter, "inputModalities", {
    enumerable: true,
    configurable: true,
    get(): readonly ("text" | "image")[] | undefined {
      if (options.inputModalities !== undefined) return options.inputModalities;
      try {
        return resolveInner().inputModalities;
      } catch {
        return undefined;
      }
    },
  });

  return adapter;
}
