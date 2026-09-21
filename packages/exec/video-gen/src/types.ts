/**
 * Text-to-video Provider seam — model tool `video_generate`.
 *
 * Unlike text-to-image, every real backend renders **asynchronously**: a create
 * call returns a job, the job is polled until it reaches a terminal state, and
 * only then can the media be downloaded. The seam models that shape directly
 * (see OpenAI `POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`)
 * instead of hiding a multi-minute render behind a single blocking call.
 */

export type VideoGenDelivery = "memory" | "openai" | "unavailable";

export type VideoGenErrorCode =
  | "VIDEO_GEN_UNAVAILABLE"
  | "VIDEO_GEN_BAD_ARGS"
  | "VIDEO_GEN_BACKEND"
  /** Job exists but has not reached `completed`; media cannot be fetched yet. */
  | "VIDEO_GEN_NOT_READY";

export class VideoGenError extends Error {
  readonly code: VideoGenErrorCode;

  constructor(message: string, code: VideoGenErrorCode = "VIDEO_GEN_BACKEND") {
    super(message);
    this.name = "VideoGenError";
    this.code = code;
  }
}

export function isVideoGenError(err: unknown): err is VideoGenError {
  return err instanceof VideoGenError;
}

/** Clip duration in seconds (provider-enumerated, not free-form). */
export type VideoGenSeconds = 4 | 8 | 12;

export type VideoGenSize = "720x1280" | "1280x720" | "1024x1792" | "1792x1024";

export type VideoGenStatus = "queued" | "in_progress" | "completed" | "failed";

export interface VideoGenRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly seconds?: VideoGenSeconds;
  readonly size?: VideoGenSize;
}

export interface VideoGenJob {
  readonly jobId: string;
  readonly status: VideoGenStatus;
  /** Approximate completion percentage when the Provider reports one. */
  readonly progress?: number;
  readonly model?: string;
  readonly seconds?: number;
  readonly size?: string;
  /** Provider error text when `status === "failed"`. */
  readonly error?: string;
  readonly provider: string;
  readonly delivery: VideoGenDelivery;
  readonly note?: string;
}

export interface VideoGenContent {
  readonly bytes: Uint8Array;
  readonly mimeType: "video/mp4";
  readonly provider: string;
  readonly note?: string;
}

/**
 * Definition: text-to-video Provider (async job lifecycle).
 * Tools always register; a missing Provider → honest execute error.
 */
export interface VideoGenService {
  /** Start a render; resolves as soon as the job is accepted. */
  create(req: VideoGenRequest): Promise<VideoGenJob>;
  /** Poll one job's current state. */
  get(jobId: string): Promise<VideoGenJob>;
  /**
   * Download the finished MP4.
   * @throws VideoGenError `VIDEO_GEN_NOT_READY` until the job is `completed`.
   */
  content(jobId: string): Promise<VideoGenContent>;
}

/** True once the job can no longer change state. */
export function isTerminalStatus(status: VideoGenStatus): boolean {
  return status === "completed" || status === "failed";
}
