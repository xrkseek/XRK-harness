import type { LlmAdapter } from "@xrkseek/llm";
import type { ImageMediaType } from "@xrkseek/protocol";
import {
  createOpenAiCompatibleAdapter,
  type OpenAiCompatibleOptions,
} from "@xrkseek/llm-openai-compatible";
import {
  DeepSeekFileStore,
  DEFAULT_DEEPSEEK_FILE_POLICY,
  requestImageVariantId,
} from "./file-store.js";
import { imageVariantId } from "./upload-index.js";
import {
  resolveDeepSeekRequestImagePolicy,
  type DeepSeekReadImageRequest,
} from "./request-policy.js";

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

/** Experimental vision model on the official host (DSH `dsh-v0.1.1-rc.2` catalog). */
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
  "baseUrl" | "id" | "model" | "wireImagePart"
> & {
  readonly id?: string;
  /** Override host; default {@link DEEPSEEK_DEFAULT_BASE_URL}. `/v1` also accepted by DeepSeek. */
  readonly baseUrl?: string;
  /** Default {@link DEEPSEEK_DEFAULT_MODEL}. */
  readonly model?: string;
  /** Override Files API reuse store (tests). */
  readonly fileStore?: DeepSeekFileStore;
  /** When false, vision on the official host uses inline base64 only. */
  readonly preferFilesApi?: boolean;
  /** Local attachment `readImageRequest` (DSH unified request-image). */
  readonly readImageRequest?: DeepSeekReadImageRequest;
};

function shouldPreferFilesApi(
  baseUrl: string,
  modalities: readonly DeepSeekInputModality[],
  preferFilesApi: boolean | undefined,
): boolean {
  if (preferFilesApi === false) return false;
  if (preferFilesApi === true) return true;
  return isOfficialDeepSeekBaseUrl(baseUrl) && modalities.includes("image");
}

/**
 * Thin DeepSeek adapter: defaults + openai-compatible wire.
 * Official vision routes prefer the Files API with durable reuse
 * (`dsh-v0.1.1-rc.2`), falling back to inline base64 on transport failure.
 */
export function createDeepSeekAdapter(
  options: DeepSeekAdapterOptions,
): LlmAdapter {
  const {
    baseUrl = DEEPSEEK_DEFAULT_BASE_URL,
    model = DEEPSEEK_DEFAULT_MODEL,
    id = "deepseek",
    deepseekThinking = true,
    fileStore = new DeepSeekFileStore(
      options.fetch === undefined ? {} : { fetch: options.fetch },
    ),
    preferFilesApi,
    readImageRequest,
    ...rest
  } = options;

  const inputModalities = resolveDeepSeekInputModalities({
    baseUrl,
    model,
    ...(rest.inputModalities !== undefined
      ? { override: rest.inputModalities }
      : {}),
  });

  const useFiles = shouldPreferFilesApi(
    baseUrl,
    inputModalities,
    preferFilesApi,
  );

  return createOpenAiCompatibleAdapter({
    ...rest,
    id,
    baseUrl,
    model,
    deepseekThinking,
    inputModalities,
    ...(useFiles
      ? {
          wireImagePart: async (stored, ctx) => {
            const ref = stored.ref;
            let data = stored.data;
            let mediaType = stored.mediaType as ImageMediaType;
            let variantId = requestImageVariantId(
              stored.attachmentId,
              stored.data,
              mediaType,
            );
            if (ref && readImageRequest) {
              const policy = resolveDeepSeekRequestImagePolicy(model);
              const req = await readImageRequest(ref, policy, ctx.signal);
              data = req.data;
              mediaType = req.mediaType;
              variantId = imageVariantId(req.variantId);
            }
            const version = {
              attachmentId: stored.attachmentId,
              variantId,
              mediaType,
              data,
              bytes: data.byteLength,
            };
            try {
              const ref = await fileStore.ensureUploaded(
                version,
                { baseURL: ctx.baseUrl, apiKey: ctx.apiKey },
                DEFAULT_DEEPSEEK_FILE_POLICY,
                ctx.signal,
              );
              return { type: "file" as const, file_id: ref.record.fileId };
            } catch {
              const b64 = Buffer.from(data).toString("base64");
              return {
                type: "image_url" as const,
                image_url: {
                  url: `data:${mediaType};base64,${b64}`,
                },
              };
            }
          },
        }
      : {}),
  });
}

export {
  DeepSeekFileStore,
  DEFAULT_DEEPSEEK_FILE_POLICY,
  requestImageVariantId,
} from "./file-store.js";
export {
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
  resolveDeepSeekRequestImagePolicy,
  type DeepSeekReadImageRequest,
} from "./request-policy.js";
export { DeepSeekFilesClient } from "./files-api.js";
