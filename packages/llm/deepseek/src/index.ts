import type { LlmAdapter } from "@xrkseek/llm";
import {
  createOpenAiCompatibleAdapter,
  type OpenAiCompatibleOptions,
} from "@xrkseek/llm-openai-compatible";

/** Official OpenAI-compatible Chat Completions host (docs: api-docs.deepseek.com). */
export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

/** True for the vendor-hosted API; custom gateways may expose vision. */
export function isOfficialDeepSeekBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return (
    trimmed === "https://api.deepseek.com" ||
    trimmed === "https://api.deepseek.com/v1" ||
    trimmed === "http://api.deepseek.com" ||
    trimmed === "http://api.deepseek.com/v1"
  );
}

/** Stable chat alias; override with platform model ids as needed. */
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";

export type DeepSeekAdapterOptions = Omit<
  OpenAiCompatibleOptions,
  "baseUrl" | "id" | "model"
> & {
  readonly id?: string;
  /** Override host; default {@link DEEPSEEK_DEFAULT_BASE_URL}. `/v1` also accepted by DeepSeek. */
  readonly baseUrl?: string;
  /** Default {@link DEEPSEEK_DEFAULT_MODEL}. */
  readonly model?: string;
};

/**
 * Thin DeepSeek adapter: defaults + openai-compatible wire.
 * Optional `reasoning` on chat responses when the vendor returns
 * `reasoning_content`. Default `stream()` emits reasoning-delta.
 * Emits `thinking` / `reasoning_effort` from request + optional defaults
 * (DSH `serializeRequest`). Does not declare image modality on the official host.
 */
export function createDeepSeekAdapter(
  options: DeepSeekAdapterOptions,
): LlmAdapter {
  const {
    baseUrl = DEEPSEEK_DEFAULT_BASE_URL,
    model = DEEPSEEK_DEFAULT_MODEL,
    id = "deepseek",
    deepseekThinking = true,
    ...rest
  } = options;

  return createOpenAiCompatibleAdapter({
    ...rest,
    id,
    baseUrl,
    model,
    deepseekThinking,
    inputModalities:
      rest.inputModalities ??
      (isOfficialDeepSeekBaseUrl(baseUrl) ? ["text"] : ["text", "image"]),
  });
}
