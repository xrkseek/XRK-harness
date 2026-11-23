/**
 * Outbound session affinity for prompt-cache routing.
 *
 * Layered by official docs — do not cross-apply vendor headers:
 *
 * - OpenCode Go / Zen: `x-opencode-session` (+ `x-session-id` sibling)
 *   https://opencode.ai/docs/go/
 * - Command Code Provider API: Bearer (+ optional `x-cmd-zdr`); CLI sticky
 *   routing uses stable `x-session-id` — never `x-opencode-session`
 *   https://commandcode.ai/docs/provider-api
 * - OpenAI Responses: body `prompt_cache_key` (session-stable)
 *   https://platform.openai.com/docs/guides/prompt-caching
 * - Generic / Custom / relays: `x-session-id` when the harness session is
 *   known (sticky gateways); ignored by vendors that do not use it.
 *
 * Prefix stability (`systemPromptUpdate: in-history`) is separate —
 * see `conversation-updates.ts`.
 */

import type { ProviderBinding, ProtocolId } from "./types.js";

export function isOpenCodeBinding(binding: ProviderBinding): boolean {
  if (binding.provider === "opencode" || binding.provider === "opencode-go") {
    return true;
  }
  return /opencode\.ai\/(?:zen(?:\/go)?|inference)\b/i.test(binding.baseUrl);
}

export function isCommandCodeBinding(binding: ProviderBinding): boolean {
  if (binding.provider === "commandcode") return true;
  return /(?:^|\.)commandcode\.ai\b/i.test(binding.baseUrl);
}

function resolveSessionId(
  binding: ProviderBinding,
  sessionId?: string,
): string | undefined {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (sid) return sid;
  // OpenCode Go requires a session header (validated harnesses); invent only
  // for preflight / key checks — never invent a shared id for other hosts
  // (that would collide unrelated conversations onto one cache key).
  if (isOpenCodeBinding(binding)) return `xrk-${binding.provider}`;
  return undefined;
}

/**
 * Host-specific affinity headers. OpenCode and Command Code never share
 * each other's proprietary headers.
 */
export function sessionAffinityHeaders(
  binding: ProviderBinding,
  sessionId?: string,
): Record<string, string> | undefined {
  const sid = resolveSessionId(binding, sessionId);
  if (!sid) return undefined;

  if (isOpenCodeBinding(binding)) {
    return {
      "x-opencode-session": sid,
      "x-session-id": sid,
    };
  }

  // Command Code + generic / Custom / brand relays: stable x-session-id only.
  return { "x-session-id": sid };
}

/**
 * OpenAI Responses `prompt_cache_key` — session-stable for every Responses
 * route (OpenAI docs), not an OpenCode-only knob. Chat Completions omit it.
 */
export function responsesPromptCacheKey(
  protocol: ProtocolId,
  sessionId?: string,
): string | undefined {
  if (protocol !== "openai-responses") return undefined;
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  return sid || undefined;
}
