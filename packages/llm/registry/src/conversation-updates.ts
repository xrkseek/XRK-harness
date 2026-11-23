/**
 * Resolve transcript update modes from protocol + optional catalog facts.
 *
 * Mirrors DSH `llm-pi-ai` `conversationUpdates(model)` without requiring a
 * pi-ai `Model` object: that package reads `compat.supportsMidConvoSystemMessages`
 * from the installed catalog; we map the same capability from wire protocol
 * defaults and explicit overrides (DeepSeek catalog / Face / BrandEntry).
 *
 * Field rule: only emit a mode when the protocol can carry it. Chat Completions
 * never gets `toolUpdate` (no `defer_loading` / `tool_addition`); Gemini stays
 * leading-only for system unless catalog forces otherwise.
 */

import type { SystemPromptUpdate, ToolUpdate } from "@xrkseek/llm";
import { protocolSupportsToolUpdate } from "@xrkseek/llm";
import type { ProtocolId } from "./types.js";

/** Optional mid-convo flags (pi-ai `compat` shape, subset). */
export interface ConversationCompat {
  readonly supportsMidConvoSystemMessages?: boolean;
}

export interface ConversationUpdatesInput {
  readonly protocol: ProtocolId;
  /**
   * Catalog / Face override.
   * - `'in-history'` — force series append
   * - `false` — force leading-only (withhold), even on a mid-convo protocol
   * - omitted — derive from compat / protocol default
   */
  readonly systemPromptUpdate?: SystemPromptUpdate | false;
  /**
   * Catalog / Face override for mid-conversation tool declarations.
   * - `'addition-only'` | `'in-history'` — only applied when the protocol
   *   supports Messages-style tool updates (`anthropic-messages`)
   * - `false` — withhold even on a supporting protocol
   * - omitted — no toolUpdate (full tools[] every request)
   */
  readonly toolUpdate?: ToolUpdate | false;
  readonly compat?: ConversationCompat;
}

export type ConversationUpdates = {
  readonly systemPromptUpdate?: SystemPromptUpdate;
  readonly toolUpdate?: ToolUpdate;
};

/**
 * Protocols whose ChatMessage wire can keep message 0 byte-stable and append a
 * later `system` (OpenAI Chat Completions / Responses, Anthropic Messages).
 * Gemini uses a singular `systemInstruction` — no default.
 */
function protocolSupportsMidConvoSystem(protocol: ProtocolId): boolean {
  switch (protocol) {
    case "openai-chat":
    case "openai-completions":
    case "openai-responses":
    case "anthropic-messages":
      return true;
    case "gemini-generate":
      return false;
    default:
      return false;
  }
}

function resolveSystemPromptUpdate(
  input: ConversationUpdatesInput,
): SystemPromptUpdate | undefined {
  if (input.systemPromptUpdate === false) return undefined;
  if (input.systemPromptUpdate === "in-history") return "in-history";

  const compatFlag = input.compat?.supportsMidConvoSystemMessages;
  if (compatFlag === false) return undefined;
  if (compatFlag === true) return "in-history";

  if (protocolSupportsMidConvoSystem(input.protocol)) return "in-history";
  return undefined;
}

/**
 * Resolve toolUpdate only when the wire can express it.
 * Unsupported protocols drop the catalog flag (no redundant defer fields).
 */
function resolveToolUpdate(
  input: ConversationUpdatesInput,
): ToolUpdate | undefined {
  if (input.toolUpdate === false || input.toolUpdate === undefined) {
    return undefined;
  }
  if (!protocolSupportsToolUpdate(input.protocol)) return undefined;
  if (
    input.toolUpdate === "addition-only" ||
    input.toolUpdate === "in-history"
  ) {
    return input.toolUpdate;
  }
  return undefined;
}

/**
 * @returns update modes for the agent loop / adapters.
 * Omitted fields mean "not capable / not declared" — callers must not invent wire.
 */
export function conversationUpdates(
  input: ConversationUpdatesInput,
): ConversationUpdates {
  const systemPromptUpdate = resolveSystemPromptUpdate(input);
  const toolUpdate = resolveToolUpdate(input);
  return {
    ...(systemPromptUpdate !== undefined ? { systemPromptUpdate } : {}),
    ...(toolUpdate !== undefined ? { toolUpdate } : {}),
  };
}
