/**
 * Place assembled system text onto the chat wire for one LLM request.
 *
 * With `systemPromptUpdate: 'in-history'` and a retained series baseline, a
 * changed effective prompt is appended after history so message 0 stays
 * byte-stable (provider KV series). See `series-baseline.ts`.
 *
 * When the new text merely extends the baseline (`baseline + "\n\n" + delta`),
 * only the delta is appended — re-sending the whole persona on every plan/time
 * refresh wastes uncached tokens at the tail.
 */

import type { SystemPromptUpdate } from "@xrkseek/llm";
import type { ChatMessage } from "@xrkseek/protocol";

/**
 * Payload for a trailing in-history system message.
 * Prefer the suffix after a shared baseline prefix; otherwise the full text.
 */
export function systemAppendAfterBaseline(
  baseline: string,
  text: string,
): string {
  if (text === baseline) return text;
  if (!text.startsWith(baseline)) return text;
  const rest = text.slice(baseline.length);
  if (!rest.startsWith("\n")) return text;
  const trimmed = rest.replace(/^\n+/, "");
  return trimmed.length > 0 ? trimmed : text;
}

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
    const append = systemAppendAfterBaseline(
      input.seriesBaselineSystem,
      text,
    );
    // Keep message 0 byte-stable; append only the growth (or full rewrite).
    return {
      messages: [
        { role: "system", content: input.seriesBaselineSystem },
        ...input.history,
        { role: "system", content: append },
      ],
      seriesBaselineSystem: input.seriesBaselineSystem,
    };
  }
  return {
    messages: [{ role: "system", content: text }, ...input.history],
    seriesBaselineSystem: text,
  };
}
