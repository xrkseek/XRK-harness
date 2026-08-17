import type { ImageAttachmentRef } from "@xrkseek/protocol";
import { attachmentIdForBytes } from "./digest.js";
import { AttachmentError } from "./error.js";
import { readImageSize, sniffImageMediaType } from "./image-meta.js";
import type { AttachmentStore } from "./store.js";
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageAttachmentLimits,
  type SaveImageAttachment,
  type StoredImageAttachment,
} from "./types.js";

export interface CreateMemoryAttachmentStoreOptions {
  readonly imageLimits?: Partial<ImageAttachmentLimits>;
}

function resolveLimits(
  partial?: Partial<ImageAttachmentLimits>,
): ImageAttachmentLimits {
  return {
    ...DEFAULT_IMAGE_LIMITS,
    ...partial,
    mediaTypes: partial?.mediaTypes ?? DEFAULT_IMAGE_LIMITS.mediaTypes,
  };
}

/**
 * In-memory content-addressed attachment store (tests + Host default).
 */
export function createMemoryAttachmentStore(
  options?: CreateMemoryAttachmentStoreOptions,
): AttachmentStore {
  const imageLimits = resolveLimits(options?.imageLimits);
  const objects = new Map<string, StoredImageAttachment>();

  async function validateImage(input: SaveImageAttachment): Promise<void> {
    if (!imageLimits.mediaTypes.includes(input.mediaType)) {
      throw new AttachmentError(
        `Image type ${input.mediaType} is not accepted.`,
        "UNSUPPORTED_IMAGE_TYPE",
      );
    }
    if (input.data.byteLength > imageLimits.maxImageBytes) {
      throw new AttachmentError(
        "Image exceeds the configured byte limit.",
        "IMAGE_TOO_LARGE",
      );
    }
    const sniffed = sniffImageMediaType(input.data);
    if (!sniffed || sniffed !== input.mediaType) {
      throw new AttachmentError(
        "Encoded bytes do not match the declared image media type.",
        "INVALID_IMAGE",
      );
    }
    const size = readImageSize(input.data, input.mediaType);
    if (!size || size.width < 1 || size.height < 1) {
      throw new AttachmentError(
        "Could not read intrinsic image dimensions.",
        "INVALID_IMAGE",
      );
    }
    if (size.width * size.height > imageLimits.maxImagePixels) {
      throw new AttachmentError(
        "Image exceeds the configured pixel limit.",
        "PIXELS_TOO_LARGE",
      );
    }
  }

  async function saveImage(
    input: SaveImageAttachment,
  ): Promise<ImageAttachmentRef> {
    await validateImage(input);
    const size = readImageSize(input.data, input.mediaType)!;
    const attachmentId = attachmentIdForBytes(input.data);
    const existing = objects.get(attachmentId);
    if (existing) return existing.ref;

    const ref: ImageAttachmentRef = {
      attachmentId,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: size.width,
      height: size.height,
      ...(input.name !== undefined ? { name: input.name } : {}),
    };
    objects.set(attachmentId, {
      ref,
      data: Uint8Array.from(input.data),
    });
    return ref;
  }

  async function saveImages(
    inputs: readonly SaveImageAttachment[],
  ): Promise<readonly ImageAttachmentRef[]> {
    if (inputs.length > imageLimits.maxImagesPerMessage) {
      throw new AttachmentError(
        "Image batch exceeds the configured image-count limit.",
        "TOO_MANY_IMAGES",
      );
    }
    const totalBytes = inputs.reduce((sum, x) => sum + x.data.byteLength, 0);
    if (totalBytes > imageLimits.maxMessageImageBytes) {
      throw new AttachmentError(
        "Image batch exceeds the configured aggregate image-byte limit.",
        "IMAGES_TOO_LARGE",
      );
    }
    for (const input of inputs) await validateImage(input);
    const refs: ImageAttachmentRef[] = [];
    for (const input of inputs) refs.push(await saveImage(input));
    return refs;
  }

  async function readImage(attachmentId: string): Promise<StoredImageAttachment> {
    const hit = objects.get(attachmentId);
    if (!hit) {
      throw new AttachmentError(
        `Attachment not found: ${attachmentId}`,
        "NOT_FOUND",
      );
    }
    return hit;
  }

  return {
    imageLimits,
    validateImage,
    saveImages,
    saveImage,
    readImage,
  };
}
