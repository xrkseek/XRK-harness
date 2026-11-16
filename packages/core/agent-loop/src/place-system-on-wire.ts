/**
 * Place assembled system text onto the chat wire for one LLM request.
 *
 * With `systemPromptUpdate: 'in-history'` and a retained series baseline, a
 * changed effective prompt is appended after history so message 0 stays
 * byte-stable (provider KV series). See `series-baseline.ts`.
 */

import type { SystemPromptUpdate } from "@xrkseek/llm";
import type { ChatMessage } from "@xrkseek/protocol";

export function placeSystemOnWire(input: {
  readonly systemText: string;
  readonly history: readonly ChatMessage[];
  readonly systemPromptUpdate?: SystemPromptUpdate;
  readonly seriesBaselineSystem?: string;
}): {
  readonly messages: ChatMessage[];
  /** Anchoring system text for the current KV-cache series (leading message). */
  readonly seriesBaselineSystem?: string;
} {
  const text = input.systemText;
  if (!text.trim()) {
    return {
      messages: [...input.history],
      ...(input.seriesBaselineSystem !== undefined
        ? { seriesBaselineSystem: input.seriesBaselineSystem }
        : {}),
    };
  }
  const inHistory = input.systemPromptUpdate === "in-history";
  if (
    inHistory &&
    input.seriesBaselineSystem !== undefined &&
    input.seriesBaselineSystem !== text
  ) {
    // Keep message 0 byte-stable; append the new effective prompt after history.
    return {
      messages: [
        { role: "system", content: input.seriesBaselineSystem },
        ...input.history,
        { role: "system", content: text },
      ],
      seriesBaselineSystem: input.seriesBaselineSystem,
    };
  }
  return {
    messages: [{ role: "system", content: text }, ...input.history],
    seriesBaselineSystem: text,
  };
}
