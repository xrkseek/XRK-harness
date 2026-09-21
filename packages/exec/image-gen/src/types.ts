/**
 * Text-to-image Provider seam — model tool `image_generate`.
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

export type ImageGenSize = "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";

export interface ImageGenRequest {
  readonly prompt: string;
  readonly size?: ImageGenSize;
  readonly n?: number;
  readonly model?: string;
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
}

/**
 * Definition: text-to-image Provider.
 * Tools always register; missing Provider → honest execute error.
 */
export interface ImageGenService {
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}
