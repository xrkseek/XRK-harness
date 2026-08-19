/**
 * @xrkseek/attachment — durable image blob store (DSH-aligned).
 * Session events hold ImageAttachmentRef only; bytes live here.
 */

export type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
  StoredImageAttachment,
} from "./types.js";
export {
  DEFAULT_IMAGE_LIMITS,
  IMAGE_MEDIA_TYPES,
} from "./types.js";
export {
  AttachmentError,
  isAttachmentError,
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
