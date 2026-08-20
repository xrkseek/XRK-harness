/**
 * Fixed-density heuristic token pricing (DSH token-meter estimate.ts).
 * Shared by Face meter fold and compaction shadow-price producers.
 */

import type { MessageContent, ToolCall } from "@xrkseek/protocol";

const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
export const ROLE_OVERHEAD = 4;

export function estimateText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateContent(content: MessageContent): number {
  if (typeof content === "string") {
    return estimateText(content) + BLOCK_OVERHEAD;
  }
  let tokens = 0;
  for (const block of content) {
    if (block.type === "text") {
      tokens += estimateText(block.text) + BLOCK_OVERHEAD;
    } else {
      tokens +=
        BLOCK_OVERHEAD +
        Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return tokens;
}

export function estimateMessageContent(content: MessageContent): number {
  return estimateContent(content) + ROLE_OVERHEAD;
}

export function estimateToolCall(call: ToolCall): number {
  const args =
    typeof call.arguments === "string"
      ? call.arguments
      : JSON.stringify(call.arguments ?? {});
  return estimateText(call.name) + estimateText(args) + BLOCK_OVERHEAD;
}

export function estimateAssistantSurface(
  content: string,
  toolCalls?: readonly ToolCall[],
): number {
  let tokens = estimateMessageContent(content);
  if (!toolCalls?.length) return tokens;
  for (const call of toolCalls) {
    tokens += estimateToolCall(call);
  }
  return tokens;
}

export function estimateSystemTokens(system: string | undefined): number {
  if (!system?.trim()) return 0;
  return estimateText(system) + ROLE_OVERHEAD;
}

export function estimateToolsTokens(
  tools:
    | readonly {
        readonly name: string;
        readonly description: string;
        readonly parameters: Record<string, unknown>;
      }[]
    | undefined,
): number {
  if (!tools || tools.length === 0) return 0;
  return (
    Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
  );
}
