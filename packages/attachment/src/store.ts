import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from "./types.js";

/**
 * Durable image blob seam. Implementations validate before publishing a ref.
 * Session events must never embed raw bytes — only ImageAttachmentRef.
 */
export interface AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits;
  /** Validate without persisting. */
  validateImage(input: SaveImageAttachment): Promise<void>;
  /** Validate all, then commit each; fail before any write on validation error. */
  saveImages(
    inputs: readonly SaveImageAttachment[],
  ): Promise<readonly ImageAttachmentRef[]>;
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>;
  readImage(attachmentId: string): Promise<StoredImageAttachment>;
  /**
   * Derive or read a cached model-request version. Local store implements;
   * memory store rejects.
   */
  readImageRequest?(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment>;
}
