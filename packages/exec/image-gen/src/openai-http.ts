/**
 * OpenAI Images API Provider (`POST /images/generations`).
 */
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageGenService,
  ImageGenSize,
} from "./types.js";
import { ImageGenError } from "./types.js";

export interface OpenAiImageGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  readonly defaultSize?: ImageGenSize;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

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

  return {
    async generate(req: ImageGenRequest): Promise<ImageGenResult> {
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new ImageGenError("prompt is empty", "IMAGE_GEN_BAD_ARGS");
      }
      const n = Math.min(Math.max(req.n ?? 1, 1), 4);
      // dall-e-3 only supports n=1
      const bodyN = model.includes("dall-e-3") ? 1 : n;
      const res = await fetchImpl(joinUrl(baseUrl, "images/generations"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: req.model ?? model,
          prompt,
          n: bodyN,
          size: req.size ?? defaultSize,
          response_format: "b64_json",
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ImageGenError(
          `OpenAI images HTTP ${res.status}: ${body.slice(0, 200)}`,
          "IMAGE_GEN_BACKEND",
        );
      }
      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
      };
      const rows = json.data ?? [];
      if (rows.length === 0) {
        throw new ImageGenError(
          "OpenAI images response missing data",
          "IMAGE_GEN_BACKEND",
        );
      }
      const images = rows.map((row) => {
        if (row.b64_json) {
          return {
            bytes: Uint8Array.from(Buffer.from(row.b64_json, "base64")),
            mimeType: "image/png" as const,
            ...(row.revised_prompt
              ? { revisedPrompt: row.revised_prompt }
              : {}),
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
      return {
        images,
        provider: "openai",
        delivery: "openai",
        note: `openai-images model=${req.model ?? model} n=${images.length}`,
      };
    },
  };
}
