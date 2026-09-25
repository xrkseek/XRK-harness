/**
 * OpenAI Images API Provider — `POST /images/generations` + `POST /images/edits`.
 * Edit when `referenceImages` non-empty (Hermes openai plugin / Codex ImageGen edit).
 */
import type {
  ImageGenCapabilities,
  ImageGenRequest,
  ImageGenResult,
  ImageGenService,
  ImageGenSize,
  ImageGenSourceImage,
} from "./types.js";
import { ImageGenError } from "./types.js";

export interface OpenAiImageGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  readonly defaultSize?: ImageGenSize;
  /** Override capabilities (default: text+image, max 16 refs). */
  readonly capabilities?: ImageGenCapabilities;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function extForMime(mime: ImageGenSourceImage["mimeType"]): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function parseOpenAiImageRows(
  json: {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  },
): ImageGenResult["images"] {
  const rows = json.data ?? [];
  if (rows.length === 0) {
    throw new ImageGenError(
      "OpenAI images response missing data",
      "IMAGE_GEN_BACKEND",
    );
  }
  return rows.map((row) => {
    if (row.b64_json) {
      return {
        bytes: Uint8Array.from(Buffer.from(row.b64_json, "base64")),
        mimeType: "image/png" as const,
        ...(row.revised_prompt ? { revisedPrompt: row.revised_prompt } : {}),
        ...(row.url ? { url: row.url } : {}),
      };
    }
    if (row.url) {
      throw new ImageGenError(
        "OpenAI returned url without b64_json; retry with response_format=b64_json",
        "IMAGE_GEN_BACKEND",
      );
    }
    throw new ImageGenError(
      "OpenAI image row missing b64_json",
      "IMAGE_GEN_BACKEND",
    );
  });
}

const DEFAULT_CAPS: ImageGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 16,
};

export function createOpenAiImageGenProvider(
  options: OpenAiImageGenOptions,
): ImageGenService {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "dall-e-3";
  const defaultSize = options.defaultSize ?? "1024x1024";
  const caps = options.capabilities ?? DEFAULT_CAPS;

  return {
    capabilities() {
      return caps;
    },
    async generate(req: ImageGenRequest): Promise<ImageGenResult> {
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new ImageGenError("prompt is empty", "IMAGE_GEN_BAD_ARGS");
      }
      const refs = req.referenceImages ?? [];
      const isEdit = refs.length > 0;
      if (isEdit && caps.maxReferenceImages <= 0) {
        throw new ImageGenError(
          "OpenAI Provider configured without edit capability",
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      if (isEdit && refs.length > caps.maxReferenceImages) {
        throw new ImageGenError(
          `at most ${caps.maxReferenceImages} reference image(s) for OpenAI edit`,
          "IMAGE_GEN_BAD_ARGS",
        );
      }

      const resolvedModel = req.model ?? model;
      const n = Math.min(Math.max(req.n ?? 1, 1), 4);
      const bodyN = resolvedModel.includes("dall-e-3") ? 1 : n;
      const size = req.size ?? defaultSize;

      let res: Response;
      if (isEdit) {
        // OpenAI Images Edit — multipart (Hermes client.images.edit).
        const form = new FormData();
        form.set("model", resolvedModel);
        form.set("prompt", prompt);
        form.set("n", String(bodyN));
        form.set("size", size);
        form.set("response_format", "b64_json");
        for (let i = 0; i < refs.length; i += 1) {
          const src = refs[i]!;
          const blob = new Blob([src.bytes], { type: src.mimeType });
          form.append(
            "image",
            blob,
            `ref_${i + 1}.${extForMime(src.mimeType)}`,
          );
        }
        res = await fetchImpl(joinUrl(baseUrl, "images/edits"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: form,
        });
      } else {
        res = await fetchImpl(joinUrl(baseUrl, "images/generations"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: resolvedModel,
            prompt,
            n: bodyN,
            size,
            response_format: "b64_json",
          }),
        });
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ImageGenError(
          `OpenAI images ${isEdit ? "edit" : "generations"} HTTP ${res.status}: ${body.slice(0, 200)}`,
          "IMAGE_GEN_BACKEND",
        );
      }
      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
      };
      const images = parseOpenAiImageRows(json);
      return {
        images,
        provider: "openai",
        delivery: "openai",
        modality: isEdit ? "image" : "text",
        note: `openai-images ${isEdit ? "edit" : "generate"} model=${resolvedModel} n=${images.length} refs=${refs.length}`,
      };
    },
  };
}
