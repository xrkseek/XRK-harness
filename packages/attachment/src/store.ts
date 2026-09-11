import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveImageAttachment,
  StoredFileAttachment,
  StoredImageAttachment,
} from "./types.js";

/**
 * Durable blob seam. Implementations validate before publishing a ref.
 * Session events must never embed raw bytes — only ImageAttachmentRef / FileAttachmentRef.
 */
export interface AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits;
  readonly fileLimits: FileAttachmentLimits;
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

  validateFile(input: SaveFileAttachment): Promise<void>;
  saveFiles(
    inputs: readonly SaveFileAttachment[],
  ): Promise<readonly FileAttachmentRef[]>;
  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef>;
  readFile(attachmentId: string): Promise<StoredFileAttachment>;
  /**
   * Absolute host path of the verbatim stored file for tool/LLM read-on-demand.
   * Memory / non-host backends omit or return undefined.
   * @throws AttachmentError when the durable reference is invalid.
   */
  fileHostPath?(ref: FileAttachmentRef): string | undefined;
}
