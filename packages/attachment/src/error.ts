export type AttachmentErrorCode =
  | "IMAGE_TOO_LARGE"
  | "IMAGES_TOO_LARGE"
  | "TOO_MANY_IMAGES"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "INVALID_IMAGE"
  | "NOT_FOUND"
  | "PIXELS_TOO_LARGE";

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;
  constructor(message: string, code: AttachmentErrorCode) {
    super(message);
    this.name = "AttachmentError";
    this.code = code;
  }
}

export function isAttachmentError(err: unknown): err is AttachmentError {
  return err instanceof AttachmentError;
}
