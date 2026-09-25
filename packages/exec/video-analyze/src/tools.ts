import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import { VIDEO_ANALYZE_PROMPT_TEXT } from "./format.js";
import { materializeVideo, type VideoAnalyzeFs } from "./materialize.js";
import { wrapVideoAnalyzePrompt } from "./mime.js";
import {
  isVideoAnalyzeError,
  type VideoAnalyzeService,
} from "./types.js";

export { VIDEO_ANALYZE_PROMPT_TEXT };

export function videoAnalyzeUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
  product?: { readonly mode?: string },
): string {
  const envRaw = String(env.XRK_VIDEO_ANALYZE ?? "").trim();
  const flag =
    envRaw !== ""
      ? envRaw.toLowerCase()
      : product?.mode === "openai"
        ? "1"
        : "";
  if (!flag) {
    return (
      "Error: video analysis is not enabled. Use Settings → Plugins → Video analyze, or set " +
      "XRK_VIDEO_ANALYZE=memory (CI/demo) / XRK_VIDEO_ANALYZE=1 with OPENAI_API_KEY / " +
      "XRK_VIDEO_ANALYZE_OPENAI_KEY. Needs a video-capable multimodal model (e.g. Gemini). " +
      "See docs/video-analyze.md. Not for browser pages — use browser_vision."
    );
  }
  if (flag === "1" || flag === "openai") {
    return (
      "Error: video analyze is enabled but no API key. Set Credentials XRK_VIDEO_ANALYZE_OPENAI_KEY " +
      "(or OPENAI_API_KEY); optional base URL / model via Settings or env."
    );
  }
  return (
    "Error: no VideoAnalyzeService Provider is configured. Inject a service or set XRK_VIDEO_ANALYZE."
  );
}

export interface CreateVideoAnalyzeToolsOptions {
  readonly service?: VideoAnalyzeService;
  readonly env?: NodeJS.ProcessEnv;
  readonly product?: { readonly mode?: string };
  /** Workspace fs for local video paths (same world as read_image). */
  readonly fs?: VideoAnalyzeFs;
  readonly fetchImpl?: typeof fetch;
}

function fail(err: unknown): ToolResultContent {
  const message = isVideoAnalyzeError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return {
    content: JSON.stringify({ success: false, analysis: message }, null, 2),
    isError: true,
  };
}

/**
 * Hermes-style `video_analyze` — whole-video multimodal LLM → text JSON.
 * Boundary: not browser_vision (page shot), not video_generate (creation).
 */
export function createVideoAnalyzeTools(
  options: CreateVideoAnalyzeToolsOptions = {},
): ToolDefinition[] {
  const missing = videoAnalyzeUnavailableMessage(
    options.env ?? process.env,
    options.product,
  );
  const service = options.service;

  const tool: ToolDefinition<{
    video_url?: string;
    question?: string;
    model?: string;
  }> = {
    name: "video_analyze",
    description:
      "Analyze a video from a URL or local workspace path using a multimodal AI model. " +
      "Sends the whole video (not individual frames) to a video-capable model for understanding — " +
      "captions, scenes, motion, overlays. Use for video files; for images use read_image; " +
      "for live browser pages use browser_vision; for creating videos use video_generate. " +
      "Supports mp4, webm, mov, avi, mkv, mpeg. Large videos (>20 MB) may be slow; max ~50 MB.",
    parameters: {
      type: "object",
      properties: {
        video_url: {
          type: "string",
          description:
            "Video URL (http/https) or workspace-relative local file path to analyze.",
        },
        question: {
          type: "string",
          description:
            "Your specific question about the video. The model describes what happens and answers.",
        },
        model: {
          type: "string",
          description: "Optional override model id (video-capable multimodal).",
        },
      },
      required: ["video_url", "question"],
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "Video analyze",
      kind: "execute",
      rawInput: args,
    }),
    async execute(args) {
      if (!service) {
        return {
          content: JSON.stringify(
            { success: false, analysis: missing },
            null,
            2,
          ),
          isError: true,
        };
      }
      try {
        const videoUrl = String(args.video_url ?? "").trim();
        const question = String(args.question ?? "").trim();
        if (!videoUrl) {
          return fail(new Error("video_url must be a non-empty string"));
        }
        if (!question) {
          return fail(new Error("question must be a non-empty string"));
        }
        const materialized = await materializeVideo(videoUrl, {
          ...(options.fs ? { fs: options.fs } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const prompt = wrapVideoAnalyzePrompt(question);
        const result = await service.analyze({
          data: materialized.data,
          mediaType: materialized.mediaType,
          prompt,
          ...(args.model ? { model: String(args.model).trim() } : {}),
        });
        return {
          content: JSON.stringify(
            {
              success: true,
              analysis: result.analysis,
              provider: result.provider,
              model: result.model,
              ...(result.note ? { note: result.note } : {}),
              source: materialized.source,
              bytes: materialized.data.byteLength,
              mediaType: materialized.mediaType,
            },
            null,
            2,
          ),
        };
      } catch (err) {
        return fail(err);
      }
    },
  };

  return [tool];
}
