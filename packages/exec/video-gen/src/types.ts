/**
 * Text-to-video / image-to-video Provider seam — model tool `video_generate`.
 *
 * Unlike text-to-image, every real backend renders **asynchronously**: a create
 * call returns a job, the job is polled until it reaches a terminal state, and
 * only then can the media be downloaded. The seam models that shape directly
 * (see OpenAI `POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`)
 * instead of hiding a multi-minute render behind a single blocking call.
 *
 * Aligns Hermes `video_gen` (dynamic schema from capabilities + family catalog;
 * `image_url` → i2v) and OpenAI Videos (input_reference / edits / extensions).
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

/** How `create` was invoked (Hermes generate vs OpenAI edits/extensions). */
export type VideoGenCreateKind = "generate" | "edit" | "extend";

/** One decoded still used as first frame / reference (Hermes `image_url`). */
export interface VideoGenSourceImage {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  /** Optional label for logs (attachment id or URL stem). */
  readonly label?: string;
}

/**
 * One model family in the Provider catalog (Hermes fal `MODEL_FAMILIES`).
 * Tools / `action=catalog` surface this so the model picks a real endpoint.
 */
export interface VideoGenFamilyEntry {
  readonly id: string;
  readonly displayName: string;
  /** `"text"` = t2v; `"image"` = accepts a first-frame still. */
  readonly modalities: readonly ("text" | "image")[];
  readonly seconds: readonly VideoGenSeconds[];
  readonly sizes: readonly VideoGenSize[];
  readonly supportsEdit?: boolean;
  readonly supportsExtend?: boolean;
  readonly note?: string;
}

/**
 * Provider capability surface (Hermes `capabilities()`).
 * Tool schema is rebuilt from this — i2v / edit / extend args only when supported.
 */
export interface VideoGenCapabilities {
  /** `"text"` = t2v; `"image"` = first-frame / reference stills. */
  readonly modalities: readonly ("text" | "image")[];
  /**
   * Max stills for i2v. OpenAI Sora takes one `input_reference` (first frame).
   * 0 = text-to-video only.
   */
  readonly maxReferenceImages: number;
  /** `POST /videos/edits` (or Provider equivalent). */
  readonly supportsEdit: boolean;
  /** `POST /videos/extensions` (or Provider equivalent). */
  readonly supportsExtend: boolean;
  /** Optional family catalog (Hermes fal-style). */
  readonly families?: readonly VideoGenFamilyEntry[];
}

export interface VideoGenRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly seconds?: VideoGenSeconds;
  readonly size?: VideoGenSize;
  /**
   * Decoded first-frame still (primary). Non-empty with `kind=generate` → i2v.
   * Tools resolve URLs / attachment ids before calling the Provider.
   */
  readonly firstFrame?: VideoGenSourceImage;
  /** Extra reference stills when the Provider accepts more than one. */
  readonly referenceImages?: readonly VideoGenSourceImage[];
  /**
   * Source video job id for `kind=edit` / `kind=extend`
   * (OpenAI `video.id` on edits/extensions).
   */
  readonly sourceVideoId?: string;
  /** Default `generate`. */
  readonly kind?: VideoGenCreateKind;
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
  /** How this job was created (t2v / i2v / edit / extend). */
  readonly kind?: VideoGenCreateKind;
  /** `"text"` generation vs `"image"` first-frame i2v. */
  readonly modality?: "text" | "image";
}

export interface VideoGenContent {
  readonly bytes: Uint8Array;
  readonly mimeType: "video/mp4";
  readonly provider: string;
  readonly note?: string;
}

/** Text-only default when a Provider omits `capabilities()`. */
export const VIDEO_GEN_CAPABILITIES_TEXT_ONLY: VideoGenCapabilities = {
  modalities: ["text"],
  maxReferenceImages: 0,
  supportsEdit: false,
  supportsExtend: false,
};

export function videoGenSupportsI2v(caps: VideoGenCapabilities): boolean {
  return (
    caps.maxReferenceImages > 0 && caps.modalities.includes("image")
  );
}

/**
 * Definition: text-to-video / i2v / edit / extend Provider (async job lifecycle).
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
  /** Optional; tools rebuild schema from this (Hermes dynamic schema). */
  capabilities?(): VideoGenCapabilities;
}

/** Resolve caps with text-only fallback. */
export function resolveVideoGenCapabilities(
  service: VideoGenService | undefined,
): VideoGenCapabilities {
  if (!service?.capabilities) return VIDEO_GEN_CAPABILITIES_TEXT_ONLY;
  return service.capabilities();
}

/** True once the job can no longer change state. */
export function isTerminalStatus(status: VideoGenStatus): boolean {
  return status === "completed" || status === "failed";
}
