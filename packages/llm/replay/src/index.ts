import type { LlmAdapter, LlmChatRequest, LlmChatResponse } from "@xrkseek/llm";

/** Fixture-driven adapter for keyless tests. */
export function createReplayAdapter(
  responses: readonly LlmChatResponse[],
  id = "replay",
): LlmAdapter {
  let i = 0;
  return {
    id,
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      if (request.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const next = responses[i];
      if (!next) {
        throw new Error("replay adapter exhausted fixtures");
      }
      i += 1;
      return next;
    },
  };
}
