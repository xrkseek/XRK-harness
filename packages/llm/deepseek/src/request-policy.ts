import type {
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
} from "@xrkseek/attachment";

/** Default route pixel budget (DSH rc.2). */
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 640_000;
/** Default encoded-byte cap per request image. */
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;

export function resolveDeepSeekRequestImagePolicy(
  model: string,
): ImageRequestPolicy {
  void model;
  return {
    maxPixels: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    maxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  };
}

export type DeepSeekReadImageRequest = (
  ref: ImageAttachmentRef,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
) => Promise<RequestImageAttachment>;
