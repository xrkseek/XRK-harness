/**
 * OpenAI-compatible chat completions with a Hermes-style `video_url` part.
 * Needs a video-capable model (e.g. Gemini via a compatible gateway).
 */
import type {
  VideoAnalyzeRequest,
  VideoAnalyzeResult,
  VideoAnalyzeService,
} from "./types.js";
import { VideoAnalyzeError } from "./types.js";

export interface OpenAiVideoAnalyzeOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  /** Request timeout hint for AbortSignal when caller omits one (ms). */
  readonly timeoutMs?: number;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function bytesToDataUrl(data: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString("base64")}`;
}

function extractAssistantText(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (part): part is { type?: string; text?: string } =>
          typeof part === "object" && part !== null,
      )
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean);
    if (texts.length) return texts.join("\n").trim();
  }
  return undefined;
}

export function createOpenAiVideoAnalyzeProvider(
  options: OpenAiVideoAnalyzeOptions,
): VideoAnalyzeService {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultModel = options.model?.trim() || "gemini-2.0-flash";
  const timeoutMs = options.timeoutMs ?? 180_000;

  return {
    async analyze(req: VideoAnalyzeRequest): Promise<VideoAnalyzeResult> {
      if (!req.data.byteLength) {
        throw new VideoAnalyzeError(
          "Video bytes must be non-empty.",
          "VIDEO_ANALYZE_BAD_ARGS",
        );
      }
      const model = req.model?.trim() || defaultModel;
      const dataUrl = bytesToDataUrl(req.data, req.mediaType);
      // Hermes hard-caps the base64 *string* length at 50MB; we already capped raw bytes.
      const controller = new AbortController();
      const onAbort = (): void => {
        controller.abort(req.signal?.reason);
      };
      req.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        controller.abort(new Error(`video_analyze timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      try {
        const res = await fetchImpl(joinUrl(baseUrl, "chat/completions"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: req.prompt },
                  {
                    type: "video_url",
                    video_url: { url: dataUrl },
                  },
                ],
              },
            ],
          }),
        });
        const rawText = await res.text().catch(() => "");
        if (!res.ok) {
          throw new VideoAnalyzeError(
            `Video analyze HTTP ${res.status}: ${rawText.slice(0, 240)}`,
            "VIDEO_ANALYZE_BACKEND",
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText) as unknown;
        } catch (err) {
          throw new VideoAnalyzeError(
            "Video analyze response was not JSON",
            "VIDEO_ANALYZE_BACKEND",
            { cause: err },
          );
        }
        const analysis = extractAssistantText(parsed);
        if (!analysis) {
          throw new VideoAnalyzeError(
            "Empty video analysis response",
            "VIDEO_ANALYZE_EMPTY",
          );
        }
        return {
          analysis,
          provider: "openai",
          model,
          note: `bytes=${req.data.byteLength}`,
        };
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
