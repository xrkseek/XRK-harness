/**
 * DeepSeek thinking / reasoning_effort wire mapping (DSH serialize.resolveThinking).
 */
import { UnsupportedReasoningEffortError } from "@xrkseek/llm";

export type DeepSeekThinkingDefaults = {
  readonly thinking?: "enabled" | "disabled";
  readonly reasoningEffort?: "off" | "low" | "high" | "max";
};

export type DeepSeekThinkingWire = {
  readonly thinking?: { readonly type: "enabled" | "disabled" };
  readonly reasoning_effort?: "low" | "high" | "max";
};

function parseEffort(
  effort: string,
): "off" | "low" | "high" | "max" {
  if (
    effort === "off" ||
    effort === "low" ||
    effort === "high" ||
    effort === "max"
  ) {
    return effort;
  }
  throw new UnsupportedReasoningEffortError(
    `DeepSeek does not support reasoning effort "${effort}"`,
  );
}

/**
 * Resolve request effort + adapter defaults into DeepSeek chat-completions fields.
 * `off` → `thinking: disabled` and no `reasoning_effort` (never send `off` on the wire).
 */
export function resolveDeepSeekThinkingWire(
  requestEffort: string | undefined,
  defaults: DeepSeekThinkingDefaults = {},
): DeepSeekThinkingWire {
  const effort =
    requestEffort === undefined
      ? defaults.reasoningEffort
      : parseEffort(requestEffort);
  if (
    defaults.thinking === "disabled" &&
    effort !== undefined &&
    effort !== "off"
  ) {
    throw new UnsupportedReasoningEffortError(
      `DeepSeek deployment does not support reasoning effort "${effort}"`,
    );
  }
  if (effort === "off") {
    return { thinking: { type: "disabled" } };
  }
  if (effort === "low" || effort === "high" || effort === "max") {
    return {
      thinking: { type: "enabled" },
      reasoning_effort: effort,
    };
  }
  if (defaults.thinking === undefined) return {};
  return { thinking: { type: defaults.thinking } };
}
