import type {
  LlmAdapter,
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamEvent,
} from "@xrkseek/llm";
import { finalizeLlmChatResponse } from "@xrkseek/llm";

export interface ReplayAdapterOptions {
  readonly id?: string;
  /**
   * When true, expose `stream()` so agent-loop appends `assistant/chunk`.
   * Default false — existing replay tests stay chat()-only.
   */
  readonly enableStream?: boolean;
  /** Delay between stream deltas (ms). */
  readonly streamDelayMs?: number;
  /**
   * When true, hang after deltas until the request aborts (cancel e2e).
   * Ignored when `enableStream` is false.
   */
  readonly hangBeforeDone?: boolean;
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
  const streamDelayMs =
    typeof idOrOpts === "object" ? (idOrOpts.streamDelayMs ?? 0) : 0;
  const hangBeforeDone =
    typeof idOrOpts === "object" && idOrOpts.hangBeforeDone === true;
  let i = 0;

  const delay = async (): Promise<void> => {
    if (streamDelayMs <= 0) return;
    await new Promise((r) => setTimeout(r, streamDelayMs));
  };

  const waitForAbort = (signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException("aborted", "AbortError"));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  const take = (request: LlmChatRequest): LlmChatResponse => {
    if (request.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const next = responses[i];
    if (!next) {
      throw new Error("replay adapter exhausted fixtures");
    }
    i += 1;
    return finalizeLlmChatResponse(next);
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
      for (const ev of splitDeltas("reasoning-delta", 0, reasoning)) {
        await delay();
        if (request.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        yield ev;
      }
      for (const ev of splitDeltas("text-delta", textIndex, next.content)) {
        await delay();
        if (request.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        yield ev;
      }
      if (hangBeforeDone) {
        await waitForAbort(request.signal);
      }
      if (next.usage) {
        yield { type: "usage", usage: next.usage };
      }
      // Fixture may still list truncated tools; keep/drop already applied in take().
      yield {
        type: "done",
        content: next.content,
        ...(reasoning.trim() ? { reasoning } : {}),
        ...(next.toolCalls ? { toolCalls: next.toolCalls } : {}),
        ...(next.usage ? { usage: next.usage } : {}),
        ...(next.finishReason ? { finishReason: next.finishReason } : {}),
      };
    };
  }

  return adapter;
}
