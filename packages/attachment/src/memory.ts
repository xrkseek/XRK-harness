import { attachmentIdForBytes } from "./digest.js";
import { AttachmentError } from "./error.js";
import { readImageSize, sniffImageMediaType } from "./image-meta.js";
import type { AttachmentStore } from "./store.js";
import {
  DEFAULT_FILE_LIMITS,
  DEFAULT_IMAGE_LIMITS,
  sanitizeAttachmentFileName,
  type FileAttachmentLimits,
  type FileAttachmentRef,
  type ImageAttachmentLimits,
  type ImageAttachmentRef,
  type ImageRequestPolicy,
  type RequestImageAttachment,
  type SaveFileAttachment,
  type SaveImageAttachment,
  type StoredFileAttachment,
  type StoredImageAttachment,
} from "./types.js";

export interface CreateMemoryAttachmentStoreOptions {
  readonly imageLimits?: Partial<ImageAttachmentLimits>;
  readonly fileLimits?: Partial<FileAttachmentLimits>;
}

function resolveImageLimits(
  partial?: Partial<ImageAttachmentLimits>,
): ImageAttachmentLimits {
  return {
    ...DEFAULT_IMAGE_LIMITS,
    ...partial,
    mediaTypes: partial?.mediaTypes ?? DEFAULT_IMAGE_LIMITS.mediaTypes,
  };
}

function resolveFileLimits(
  partial?: Partial<FileAttachmentLimits>,
): FileAttachmentLimits {
  return {
    ...DEFAULT_FILE_LIMITS,
    ...partial,
  };
}

/**
 * In-memory content-addressed attachment store (tests + Host default).
 * Images and generic files share digest space but keep typed refs.
 */
export function createMemoryAttachmentStore(
  options?: CreateMemoryAttachmentStoreOptions,
): AttachmentStore {
  const imageLimits = resolveImageLimits(options?.imageLimits);
  const fileLimits = resolveFileLimits(options?.fileLimits);
  const images = new Map<string, StoredImageAttachment>();
  const files = new Map<string, StoredFileAttachment>();

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
    const existing = images.get(attachmentId);
    if (existing) return existing.ref;

    const ref: ImageAttachmentRef = {
      attachmentId,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: size.width,
      height: size.height,
      ...(input.name !== undefined ? { name: input.name } : {}),
    };
    images.set(attachmentId, {
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
    const hit = images.get(attachmentId);
    if (!hit) {
      throw new AttachmentError(
        `Attachment not found: ${attachmentId}`,
        "NOT_FOUND",
      );
    }
    return hit;
  }

  async function readImageRequest(
    ref: ImageAttachmentRef,
    _policy: ImageRequestPolicy,
    _signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    void ref;
    void _policy;
    throw new AttachmentError(
      "The mounted attachment provider cannot derive model-request images.",
      "ATTACHMENT_PROJECTION_UNSUPPORTED",
    );
  }

  async function validateFile(input: SaveFileAttachment): Promise<void> {
    if (input.data.byteLength === 0) {
      throw new AttachmentError(
        "File bytes must be non-empty.",
        "INVALID_ATTACHMENT_REF",
      );
    }
    if (input.data.byteLength > fileLimits.maxFileBytes) {
      throw new AttachmentError(
        "File exceeds the configured byte limit.",
        "FILE_TOO_LARGE",
      );
    }
  }

  async function saveFile(
    input: SaveFileAttachment,
  ): Promise<FileAttachmentRef> {
    await validateFile(input);
    const attachmentId = attachmentIdForBytes(input.data);
    const existing = files.get(attachmentId);
    if (existing) return existing.ref;

    const ref: FileAttachmentRef = {
      attachmentId,
      name: sanitizeAttachmentFileName(input.name),
      bytes: input.data.byteLength,
      ...(input.mediaType !== undefined && input.mediaType.length > 0
        ? { mediaType: input.mediaType }
        : {}),
    };
    files.set(attachmentId, {
      ref,
      data: Uint8Array.from(input.data),
    });
    return ref;
  }

  async function saveFiles(
    inputs: readonly SaveFileAttachment[],
  ): Promise<readonly FileAttachmentRef[]> {
    if (inputs.length > fileLimits.maxFilesPerMessage) {
      throw new AttachmentError(
        "File batch exceeds the configured file-count limit.",
        "TOO_MANY_FILES",
      );
    }
    const totalBytes = inputs.reduce((sum, x) => sum + x.data.byteLength, 0);
    if (totalBytes > fileLimits.maxMessageFileBytes) {
      throw new AttachmentError(
        "File batch exceeds the configured aggregate file-byte limit.",
        "FILES_TOO_LARGE",
      );
    }
    for (const input of inputs) await validateFile(input);
    const refs: FileAttachmentRef[] = [];
    for (const input of inputs) refs.push(await saveFile(input));
    return refs;
  }

  async function readFile(attachmentId: string): Promise<StoredFileAttachment> {
    const hit = files.get(attachmentId);
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
    fileLimits,
    validateImage,
    saveImages,
    saveImage,
    readImage,
    readImageRequest,
    validateFile,
    saveFiles,
    saveFile,
    readFile,
  };
}
