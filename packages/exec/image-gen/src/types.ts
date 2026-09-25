/**
 * Text-to-image / image-to-image Provider seam — model tool `image_generate`.
 * Aligns Hermes `image_gen` (single tool; refs select edit) + Codex ImageGen/Edit.
 */

export type ImageGenDelivery = "memory" | "openai" | "unavailable";

export type ImageGenErrorCode =
  | "IMAGE_GEN_UNAVAILABLE"
  | "IMAGE_GEN_BAD_ARGS"
  | "IMAGE_GEN_BACKEND";

export class ImageGenError extends Error {
  readonly code: ImageGenErrorCode;

  constructor(message: string, code: ImageGenErrorCode = "IMAGE_GEN_BACKEND") {
    super(message);
    this.name = "ImageGenError";
    this.code = code;
  }
}

export function isImageGenError(err: unknown): err is ImageGenError {
  return err instanceof ImageGenError;
}

export type ImageGenSize =
  | "256x256"
  | "512x512"
  | "1024x1024"
  | "1792x1024"
  | "1024x1792";

/** One decoded source image for edit / i2i (Hermes `image_url` + refs). */
export interface ImageGenSourceImage {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  /** Optional label for logs (attachment id or URL stem). */
  readonly label?: string;
}

/**
 * Provider capability surface (Hermes `capabilities()`).
 * Tool schema is rebuilt from this — edit args appear only when supported.
 */
export interface ImageGenCapabilities {
  /** `"text"` = t2i only; `"image"` = accepts reference images for edit. */
  readonly modalities: readonly ("text" | "image")[];
  /** Max source images for edit (OpenAI Images edit ≤16). 0 = t2i only. */
  readonly maxReferenceImages: number;
}

export interface ImageGenRequest {
  readonly prompt: string;
  readonly size?: ImageGenSize;
  readonly n?: number;
  readonly model?: string;
  /**
   * Decoded reference images (primary + extras). Non-empty → edit / i2i.
   * Tools resolve URLs / attachment ids before calling the Provider.
   */
  readonly referenceImages?: readonly ImageGenSourceImage[];
}

export interface ImageGenImage {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly revisedPrompt?: string;
  readonly url?: string;
}

export interface ImageGenResult {
  readonly images: readonly ImageGenImage[];
  readonly provider: string;
  readonly delivery: ImageGenDelivery;
  readonly note?: string;
  /** `"text"` generation vs `"image"` edit (Hermes modality). */
  readonly modality?: "text" | "image";
}

/** Text-only default when a Provider omits `capabilities()`. */
export const IMAGE_GEN_CAPABILITIES_TEXT_ONLY: ImageGenCapabilities = {
  modalities: ["text"],
  maxReferenceImages: 0,
};

export function imageGenSupportsEdit(caps: ImageGenCapabilities): boolean {
  return (
    caps.maxReferenceImages > 0 && caps.modalities.includes("image")
  );
}

/**
 * Definition: text-to-image / edit Provider.
 * Tools always register; missing Provider → honest execute error.
 */
export interface ImageGenService {
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
  /** Optional; tools rebuild schema from this (Hermes dynamic schema). */
  capabilities?(): ImageGenCapabilities;
}

/** Resolve caps with text-only fallback. */
export function resolveImageGenCapabilities(
  service: ImageGenService | undefined,
): ImageGenCapabilities {
  if (!service?.capabilities) return IMAGE_GEN_CAPABILITIES_TEXT_ONLY;
  return service.capabilities();
}
