import type {
  LlmAdapter,
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamEvent,
} from "@xrkseek/llm";

export interface ReplayAdapterOptions {
  readonly id?: string;
  /**
   * When true, expose `stream()` so agent-loop appends `assistant/chunk`.
   * Default false — existing replay tests stay chat()-only.
   */
  readonly enableStream?: boolean;
}

function splitDeltas(
  type: "text-delta" | "reasoning-delta",
  index: number,
  text: string,
): LlmStreamEvent[] {
  if (!text) return [];
  if (text.length === 1) return [{ type, index, text }];
  const mid = Math.max(1, Math.floor(text.length / 2));
  const head = text.slice(0, mid);
  const tail = text.slice(mid);
  const out: LlmStreamEvent[] = [{ type, index, text: head }];
  if (tail) out.push({ type, index, text: tail });
  return out;
}

/** Fixture-driven adapter for keyless tests. */
export function createReplayAdapter(
  responses: readonly LlmChatResponse[],
  idOrOpts: string | ReplayAdapterOptions = "replay",
): LlmAdapter {
  const id = typeof idOrOpts === "string" ? idOrOpts : (idOrOpts.id ?? "replay");
  const enableStream =
    typeof idOrOpts === "object" && idOrOpts.enableStream === true;
  let i = 0;

  const take = (request: LlmChatRequest): LlmChatResponse => {
    if (request.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const next = responses[i];
    if (!next) {
      throw new Error("replay adapter exhausted fixtures");
    }
    i += 1;
    return next;
  };

  const adapter: LlmAdapter = {
    id,
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      return take(request);
    },
  };

  if (enableStream) {
    adapter.stream = async function* (
      request: LlmChatRequest,
    ): AsyncIterable<LlmStreamEvent> {
      const next = take(request);
      const reasoning = next.reasoning ?? "";
      const textIndex = reasoning ? 1 : 0;
      yield* splitDeltas("reasoning-delta", 0, reasoning);
      yield* splitDeltas("text-delta", textIndex, next.content);
      yield {
        type: "done",
        content: next.content,
        ...(reasoning.trim() ? { reasoning } : {}),
        ...(next.toolCalls ? { toolCalls: next.toolCalls } : {}),
      };
    };
  }

  return adapter;
}
