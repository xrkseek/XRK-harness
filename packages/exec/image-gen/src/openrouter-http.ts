/**
 * OpenRouter Dedicated Image API — `POST /images/generations` (Hermes openrouter).
 * Supports reference images via `image_urls` when the selected model allows.
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

export interface OpenRouterImageGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  readonly capabilities?: ImageGenCapabilities;
}

const DEFAULT_MODEL = "google/gemini-3.1-flash-image";
const DEFAULT_CAPS: ImageGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 14,
};

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function sizeToAspect(size: ImageGenSize | undefined): string {
  switch (size) {
    case "1792x1024":
      return "16:9";
    case "1024x1792":
      return "9:16";
    case "512x512":
    case "256x256":
    case "1024x1024":
    default:
      return "1:1";
  }
}

function bytesToDataUrl(img: ImageGenSourceImage): string {
  return `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}`;
}

async function downloadImage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" }> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new ImageGenError(
      `OpenRouter image download HTTP ${res.status}`,
      "IMAGE_GEN_BACKEND",
    );
  }
  const ab = await res.arrayBuffer();
  const ct = (res.headers.get("content-type") ?? "image/png")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  const mimeType =
    ct === "image/jpeg" || ct === "image/webp" || ct === "image/png"
      ? ct
      : ("image/png" as const);
  return { bytes: new Uint8Array(ab), mimeType };
}

export function createOpenRouterImageGenProvider(
  options: OpenRouterImageGenOptions,
): ImageGenService {
  const baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model?.trim() || DEFAULT_MODEL;
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
      if (refs.length > 0 && caps.maxReferenceImages <= 0) {
        throw new ImageGenError(
          "OpenRouter image Provider configured without edit/refs",
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      if (refs.length > caps.maxReferenceImages) {
        throw new ImageGenError(
          `at most ${caps.maxReferenceImages} reference image(s) for OpenRouter`,
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      const resolvedModel = req.model?.trim() || model;
      const body: Record<string, unknown> = {
        model: resolvedModel,
        prompt,
        aspect_ratio: sizeToAspect(req.size),
      };
      if (refs.length > 0) {
        body.image_urls = refs.map(bytesToDataUrl);
      }
      const res = await fetchImpl(joinUrl(baseUrl, "images/generations"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/xrkseek/XRK-harness",
          "X-Title": "XRK Harness",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ImageGenError(
          `OpenRouter images HTTP ${res.status}: ${text.slice(0, 200)}`,
          "IMAGE_GEN_BACKEND",
        );
      }
      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
        images?: Array<{ b64_json?: string; url?: string }>;
      };
      const rows = json.data ?? json.images ?? [];
      if (rows.length === 0) {
        throw new ImageGenError(
          "OpenRouter images response missing data",
          "IMAGE_GEN_BACKEND",
        );
      }
      const images = [];
      for (const row of rows) {
        if (row.b64_json) {
          images.push({
            bytes: Uint8Array.from(Buffer.from(row.b64_json, "base64")),
            mimeType: "image/png" as const,
            ...(row.url ? { url: row.url } : {}),
          });
          continue;
        }
        if (row.url) {
          const downloaded = await downloadImage(row.url, fetchImpl);
          images.push({ ...downloaded, url: row.url });
          continue;
        }
        throw new ImageGenError(
          "OpenRouter image row missing b64_json/url",
          "IMAGE_GEN_BACKEND",
        );
      }
      return {
        images,
        provider: "openrouter",
        delivery: "openrouter",
        modality: refs.length > 0 ? "image" : "text",
        note: `openrouter-images model=${resolvedModel} n=${images.length} refs=${refs.length}`,
      };
    },
  };
}
