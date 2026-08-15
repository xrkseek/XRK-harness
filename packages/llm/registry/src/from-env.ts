import type { LlmAdapter } from "@xrkseek/llm";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "./registry.js";
import type { ProviderBinding } from "./types.js";

/**
 * Build adapter from host env.
 * - `XRK_LLM_PRESET` = brand id (required to activate)
 * - `XRK_LLM_MODEL` optional
 * - `XRK_LLM_BASE_URL` optional override
 * Returns `undefined` when preset unset (caller keeps prior LLM).
 */
export function resolveLlmFromEnv(
  env: NodeJS.ProcessEnv,
  registry: ProviderRegistry = createProviderRegistry(),
): { binding: ProviderBinding; adapter: LlmAdapter } | undefined {
  const preset = env.XRK_LLM_PRESET?.trim();
  if (!preset) return undefined;

  const model = env.XRK_LLM_MODEL?.trim();
  const baseUrl = env.XRK_LLM_BASE_URL?.trim();
  const binding = registry.resolve({
    provider: preset,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });
  const rawKey = binding.apiKeyEnv
    ? env[binding.apiKeyEnv]?.trim()
    : undefined;
  const adapter = registry.createAdapter(
    binding,
    rawKey ? { apiKey: rawKey } : {},
  );
  return { binding, adapter };
}
