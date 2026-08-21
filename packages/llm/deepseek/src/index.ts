import type { LlmAdapter } from "@xrkseek/llm";
import {
  createOpenAiCompatibleAdapter,
  type OpenAiCompatibleOptions,
} from "@xrkseek/llm-openai-compatible";

/** Official OpenAI-compatible Chat Completions host (docs: api-docs.deepseek.com). */
export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

/** True for the vendor-hosted API; custom gateways may expose vision on any model. */
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

/** Experimental vision model on the official host (DSH `dsh-v0.1.1-rc.1` catalog). */
export const DEEPSEEK_VISION_EXP_MODEL = "deepseek-v4-flash-vision-exp";

export type DeepSeekInputModality = "text" | "image";

/** Advisory catalog entry shared by Face defaults and discovery consumers. */
export interface DeepSeekCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly inputModalities?: readonly DeepSeekInputModality[];
}

/**
 * Default discovery catalog (DSH `DEFAULT_MODELS`): Flash · Pro · Flash Vision Exp.
 * Official non-vision rows stay text-only; Vision Exp declares image.
 */
export const DEEPSEEK_DEFAULT_CATALOG: readonly DeepSeekCatalogModel[] = [
  {
    id: DEEPSEEK_DEFAULT_MODEL,
    name: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    inputModalities: ["text"],
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    inputModalities: ["text"],
  },
  {
    id: DEEPSEEK_VISION_EXP_MODEL,
    name: "DeepSeek V4 Flash Vision Exp",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    inputModalities: ["text", "image"],
  },
];

/** True when the model id is the official vision-exp catalog entry. */
export function isDeepSeekVisionModel(model: string): boolean {
  return model.trim() === DEEPSEEK_VISION_EXP_MODEL;
}

/**
 * Resolve adapter modalities (DSH catalog semantics).
 * Explicit override wins; Vision Exp is text+image on any host; other models on
 * the official host stay text-only; custom gateways default to text+image.
 */
export function resolveDeepSeekInputModalities(input: {
  readonly baseUrl: string;
  readonly model: string;
  readonly override?: readonly DeepSeekInputModality[];
}): readonly DeepSeekInputModality[] {
  if (input.override !== undefined) return input.override;
  if (isDeepSeekVisionModel(input.model)) return ["text", "image"];
  if (isOfficialDeepSeekBaseUrl(input.baseUrl)) return ["text"];
  return ["text", "image"];
}

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
 * (DSH `serializeRequest`). Modalities follow {@link resolveDeepSeekInputModalities}.
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
    inputModalities: resolveDeepSeekInputModalities({
      baseUrl,
      model,
      ...(rest.inputModalities !== undefined
        ? { override: rest.inputModalities }
        : {}),
    }),
  });
}
