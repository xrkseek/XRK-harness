/**
 * OpenAI-compatible · anthropic-messages · gemini-generate multimodal inference.
 */
import { analyzeImageBuffer } from "./host-feature-bridge.js";
import type { CloudVisionRoute } from "./cloud-vision-routing.js";

export const CLOUD_VISION_INFERENCE_INCOMPLETE = "cloud-vision-inference" as const;

const VISION_PROMPT =
  "Describe this image and extract any visible text (OCR). Reply in plain text only.";

/** Providers routed via chat/completions + image_url. */
export const OPENAI_COMPAT_VISION_BASE: Readonly<Record<string, string>> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  together: "https://api.together.xyz/v1",
};

export const ANTHROPIC_VISION_BASE = "https://api.anthropic.com/v1";
export const GEMINI_VISION_BASE =
  "https://generativelanguage.googleapis.com/v1beta";

function imageMime(buf: Buffer): string {
  const meta = analyzeImageBuffer(buf);
  switch (meta.format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function extractOpenAiAssistantText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: string }).text === "string"
          ? (block as { text: string }).text
          : "",
      )
      .join("\n")
      .trim();
  }
  return "";
}

function extractAnthropicAssistantText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: string }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("\n")
    .trim();
}

function extractGeminiAssistantText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content
    ?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) =>
      part &&
      typeof part === "object" &&
      typeof (part as { text?: string }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("\n")
    .trim();
}

export interface CloudVisionInferenceResult {
  readonly inferred: boolean;
  readonly texts: readonly string[];
  readonly provider?: string;
  readonly model?: string;
  readonly error?: string;
  readonly incomplete?: readonly string[];
}

async function inferOneImageOpenAiCompat(
  buf: Buffer,
  route: CloudVisionRoute,
  key: string,
  timeoutMs: number,
): Promise<string> {
  const base = OPENAI_COMPAT_VISION_BASE[route.provider ?? ""];
  if (!base || !route.model) return "";
  const mime = imageMime(buf);
  const b64 = buf.toString("base64");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${b64}` },
            },
          ],
        },
      ],
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return extractOpenAiAssistantText(await res.json());
}

async function inferOneImageAnthropic(
  buf: Buffer,
  route: CloudVisionRoute,
  key: string,
  timeoutMs: number,
): Promise<string> {
  if (!route.model) return "";
  const mime = imageMime(buf);
  const res = await fetch(`${ANTHROPIC_VISION_BASE}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: route.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime,
                data: buf.toString("base64"),
              },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return extractAnthropicAssistantText(await res.json());
}

async function inferOneImageGemini(
  buf: Buffer,
  route: CloudVisionRoute,
  key: string,
  timeoutMs: number,
): Promise<string> {
  if (!route.model) return "";
  const mime = imageMime(buf);
  const res = await fetch(
    `${GEMINI_VISION_BASE}/models/${encodeURIComponent(route.model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mime,
                  data: buf.toString("base64"),
                },
              },
              { text: VISION_PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return extractGeminiAssistantText(await res.json());
}

export async function inferCloudVisionFromImages(
  images: readonly Buffer[],
  route: CloudVisionRoute,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 120_000,
): Promise<CloudVisionInferenceResult> {
  if (!route.routed || !route.provider || !route.model || !route.apiKeyEnv) {
    return { inferred: false, texts: [] };
  }
  const key = env[route.apiKeyEnv]?.trim();
  if (!key) {
    return { inferred: false, texts: [], error: "api key missing" };
  }

  const provider = route.provider;
  const inferOne =
    provider === "anthropic"
      ? inferOneImageAnthropic
      : provider === "gemini"
        ? inferOneImageGemini
        : OPENAI_COMPAT_VISION_BASE[provider]
          ? inferOneImageOpenAiCompat
          : undefined;

  if (!inferOne) {
    return {
      inferred: false,
      texts: [],
      provider,
      model: route.model,
      incomplete: [CLOUD_VISION_INFERENCE_INCOMPLETE],
      error: `Provider ${provider} is not wired for vision inference.`,
    };
  }

  const texts: string[] = [];
  for (const buf of images.slice(0, 4)) {
    if (buf.length === 0) continue;
    try {
      const text = await inferOne(buf, route, key, timeoutMs);
      if (text) texts.push(text);
    } catch (err) {
      return {
        inferred: false,
        texts,
        provider,
        model: route.model,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    inferred: texts.length > 0,
    texts,
    provider,
    model: route.model,
  };
}
