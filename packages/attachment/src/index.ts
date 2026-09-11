/**
 * @xrkseek/attachment — durable image + generic-file blob store (DSH-aligned).
 * Session events hold ImageAttachmentRef / FileAttachmentRef only; bytes live here.
 */

export type {
  FileAttachmentLimits,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveImageAttachment,
  StoredFileAttachment,
  StoredImageAttachment,
} from "./types.js";
export {
  DEFAULT_FILE_LIMITS,
  DEFAULT_IMAGE_LIMITS,
  IMAGE_MEDIA_TYPES,
  sanitizeAttachmentFileName,
} from "./types.js";
export {
  AttachmentError,
  isAttachmentError,
  isImageAdmissionError,
  type AttachmentErrorCode,
} from "./error.js";
export type { AttachmentStore } from "./store.js";
export {
  createMemoryAttachmentStore,
  type CreateMemoryAttachmentStoreOptions,
} from "./memory.js";
export { sniffImageMediaType, readImageSize } from "./image-meta.js";
export { attachmentIdForBytes } from "./digest.js";
export {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  REQUEST_IMAGE_OFFLOAD_PLACEHOLDER,
  offloadRequestImages,
} from "./request-image-bound.js";
