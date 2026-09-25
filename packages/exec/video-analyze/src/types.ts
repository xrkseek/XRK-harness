/**
 * Video understanding Provider seam (Hermes `video_analyze`).
 * Distinct from browser_vision (page screenshot) and video_generate (async render).
 */

export type VideoAnalyzeErrorCode =
  | "VIDEO_ANALYZE_BAD_ARGS"
  | "VIDEO_ANALYZE_TOO_LARGE"
  | "VIDEO_ANALYZE_UNSUPPORTED"
  | "VIDEO_ANALYZE_FETCH"
  | "VIDEO_ANALYZE_BACKEND"
  | "VIDEO_ANALYZE_EMPTY";

export class VideoAnalyzeError extends Error {
  readonly code: VideoAnalyzeErrorCode;
  constructor(
    message: string,
    code: VideoAnalyzeErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VideoAnalyzeError";
    this.code = code;
  }
}

export function isVideoAnalyzeError(err: unknown): err is VideoAnalyzeError {
  return err instanceof VideoAnalyzeError;
}

export type VideoMediaType =
  | "video/mp4"
  | "video/webm"
  | "video/quicktime"
  | "video/mpeg"
  | "video/x-msvideo"
  | "video/x-matroska";

export interface VideoAnalyzeRequest {
  readonly data: Uint8Array;
  readonly mediaType: string;
  /** Fully expanded analysis prompt (Hermes wraps the user question). */
  readonly prompt: string;
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export interface VideoAnalyzeResult {
  readonly analysis: string;
  readonly provider: string;
  readonly model: string;
  readonly note?: string;
}

/** Swappable backend — OpenAI-compatible chat with video_url, or memory. */
export interface VideoAnalyzeService {
  analyze(req: VideoAnalyzeRequest): Promise<VideoAnalyzeResult>;
}
