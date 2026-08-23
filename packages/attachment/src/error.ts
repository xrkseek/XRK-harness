export type AttachmentErrorCode =
  | "IMAGE_TOO_LARGE"
  | "IMAGES_TOO_LARGE"
  | "TOO_MANY_IMAGES"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "INVALID_IMAGE"
  | "IMAGE_TYPE_MISMATCH"
  | "IMAGE_TOO_MANY_PIXELS"
  | "IMAGE_DIMENSION_TOO_LARGE"
  | "NOT_FOUND"
  | "PIXELS_TOO_LARGE"
  | "INVALID_ATTACHMENT_REF"
  | "ATTACHMENT_CORRUPT"
  | "ATTACHMENT_WRITE_FAILED"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_READ_FAILED"
  | "ATTACHMENT_PROJECTION_UNSUPPORTED";

const IMAGE_ADMISSION_CODES = new Set<string>([
  "TOO_MANY_IMAGES",
  "IMAGES_TOO_LARGE",
  "UNSUPPORTED_IMAGE_TYPE",
  "INVALID_IMAGE",
  "IMAGE_TYPE_MISMATCH",
  "IMAGE_TOO_LARGE",
  "IMAGE_TOO_MANY_PIXELS",
  "IMAGE_DIMENSION_TOO_LARGE",
  "PIXELS_TOO_LARGE",
]);

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;
  constructor(
    message: string,
    code: AttachmentErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AttachmentError";
    this.code = code;
  }
}

export function isAttachmentError(err: unknown): err is AttachmentError {
  return err instanceof AttachmentError;
}

export function isImageAdmissionError(
  err: unknown,
): err is AttachmentError {
  return (
    err instanceof AttachmentError &&
    IMAGE_ADMISSION_CODES.has(err.code)
  );
}
