import type {
  ImageAttachmentRef,
  ImageMediaType,
} from "@xrkseek/protocol";

export type { ImageAttachmentRef, ImageMediaType };

export const IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const satisfies readonly ImageMediaType[];

export interface ImageAttachmentLimits {
  readonly maxImageBytes: number;
  readonly maxImagesPerMessage: number;
  readonly maxMessageImageBytes: number;
  readonly maxImagePixels: number;
  readonly mediaTypes: readonly ImageMediaType[];
}

/** Defaults aligned with common DSH local attachment limits. */
export const DEFAULT_IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 20 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  mediaTypes: IMAGE_MEDIA_TYPES,
};

export interface SaveImageAttachment {
  readonly data: Uint8Array;
  readonly mediaType: ImageMediaType;
  readonly name?: string;
}

export interface StoredImageAttachment {
  readonly ref: ImageAttachmentRef;
  readonly data: Uint8Array;
}
