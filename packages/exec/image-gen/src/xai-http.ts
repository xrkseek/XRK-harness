/**
 * xAI Grok Imagine image Provider — `/v1/images/generations` + `/v1/images/edits`
 * (Hermes `plugins/image_gen/xai`; edits use JSON body, not multipart).
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

export interface XaiImageGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  /** Model used when reference images are present (Hermes quality fallback). */
  readonly editModel?: string;
  readonly capabilities?: ImageGenCapabilities;
}

const DEFAULT_MODEL = "grok-imagine-image";
const DEFAULT_EDIT_MODEL = "grok-imagine-image-quality";
const DEFAULT_CAPS: ImageGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 3,
};

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function aspectForSize(size: ImageGenSize | undefined): string {
  switch (size) {
    case "1792x1024":
      return "16:9";
    case "1024x1792":
      return "9:16";
    default:
      return "1:1";
  }
}

function bytesToDataUrl(img: ImageGenSourceImage): string {
  return `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}`;
}

function parseImageRows(
  json: {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  },
  fetchImpl: typeof fetch,
): Promise<ImageGenResult["images"]> {
  const rows = json.data ?? [];
  if (rows.length === 0) {
    throw new ImageGenError(
      "xAI images response missing data",
      "IMAGE_GEN_BACKEND",
    );
  }
  return Promise.all(
    rows.map(async (row) => {
      if (row.b64_json) {
        return {
          bytes: Uint8Array.from(Buffer.from(row.b64_json, "base64")),
          mimeType: "image/png" as const,
          ...(row.revised_prompt ? { revisedPrompt: row.revised_prompt } : {}),
          ...(row.url ? { url: row.url } : {}),
        };
      }
      if (row.url) {
        const res = await fetchImpl(row.url);
        if (!res.ok) {
          throw new ImageGenError(
            `xAI image download HTTP ${res.status}`,
            "IMAGE_GEN_BACKEND",
          );
        }
        const ab = await res.arrayBuffer();
        return {
          bytes: new Uint8Array(ab),
          mimeType: "image/png" as const,
          url: row.url,
          ...(row.revised_prompt ? { revisedPrompt: row.revised_prompt } : {}),
        };
      }
      throw new ImageGenError(
        "xAI image row missing b64_json and url",
        "IMAGE_GEN_BACKEND",
      );
    }),
  );
}

export function createXaiImageGenProvider(
  options: XaiImageGenOptions,
): ImageGenService {
  const baseUrl = (options.baseUrl ?? "https://api.x.ai/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model?.trim() || DEFAULT_MODEL;
  const editModel = options.editModel?.trim() || DEFAULT_EDIT_MODEL;
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
          "xAI Provider configured without edit capability",
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      if (isEdit && refs.length > caps.maxReferenceImages) {
        throw new ImageGenError(
          `at most ${caps.maxReferenceImages} reference image(s) for xAI edit`,
          "IMAGE_GEN_BAD_ARGS",
        );
      }

      const resolvedModel = req.model?.trim() || (isEdit ? editModel : model);
      const headers = {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      };

      let res: Response;
      if (isEdit) {
        const fields = refs.map((img) => ({
          url: bytesToDataUrl(img),
          type: "image_url" as const,
        }));
        const body: Record<string, unknown> = {
          model: resolvedModel,
          prompt,
        };
        if (fields.length === 1) body.image = fields[0];
        else body.images = fields;
        res = await fetchImpl(joinUrl(baseUrl, "images/edits"), {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      } else {
        res = await fetchImpl(joinUrl(baseUrl, "images/generations"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: resolvedModel,
            prompt,
            aspect_ratio: aspectForSize(req.size),
            resolution: "1k",
            response_format: "b64_json",
          }),
        });
      }

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new ImageGenError(
          `xAI images HTTP ${res.status}: ${text.slice(0, 240)}`,
          "IMAGE_GEN_BACKEND",
        );
      }
      let parsed: { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        throw new ImageGenError(
          "xAI images response was not JSON",
          "IMAGE_GEN_BACKEND",
        );
      }
      const images = await parseImageRows(parsed, fetchImpl);
      return {
        images,
        provider: "xai",
        delivery: "xai",
        modality: isEdit ? "image" : "text",
        note: `xai model=${resolvedModel}`,
      };
    },
  };
}
