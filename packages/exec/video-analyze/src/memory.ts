/** In-memory Provider for CI / unit tests (no network). */

import type {
  VideoAnalyzeRequest,
  VideoAnalyzeResult,
  VideoAnalyzeService,
} from "./types.js";
import { VideoAnalyzeError } from "./types.js";

export interface MemoryVideoAnalyzeOptions {
  /** Fixed analysis text; default summarizes byte length + prompt head. */
  readonly analysis?: string;
}

export function createMemoryVideoAnalyzeProvider(
  options: MemoryVideoAnalyzeOptions = {},
): VideoAnalyzeService {
  return {
    async analyze(req: VideoAnalyzeRequest): Promise<VideoAnalyzeResult> {
      if (!req.data.byteLength) {
        throw new VideoAnalyzeError(
          "Video bytes must be non-empty.",
          "VIDEO_ANALYZE_BAD_ARGS",
        );
      }
      const promptHead = req.prompt.slice(0, 80).replace(/\s+/g, " ");
      const analysis =
        options.analysis ??
        `[memory-video-analyze] bytes=${req.data.byteLength} mime=${req.mediaType} prompt=${promptHead}`;
      return {
        analysis,
        provider: "memory",
        model: req.model ?? "memory",
        note: "deterministic stub — not a real multimodal model",
      };
    },
  };
}
