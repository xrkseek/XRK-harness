/**
 * DeepSeek route request-image policy: token-grid projection (V41) then
 * optional long-edge cap, expressed as `{ maxPixels, maxBytes }` for the
 * local request-image encoder.
 */

import {
  REQUEST_IMAGE_MAX_DIMENSION,
  longEdgeDimensions,
  requestImageTokenDimensions,
  type ImageAttachmentRef,
  type ImageRequestPolicy,
  type RequestImageAttachment,
} from "@xrkseek/attachment";

/** Fallback pixel budget when source dimensions are unknown (legacy Soft path). */
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 640_000;
/** Default encoded-byte cap per request image. */
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;

/**
 * Resolve the route policy for one DeepSeek model request image.
 * When `source` width/height are known, apply V41 token-grid projection and
 * the 4096 long-edge cap so the encoder downscales before wire/upload.
 */
export function resolveDeepSeekRequestImagePolicy(
  model: string,
  source?: Pick<ImageAttachmentRef, "width" | "height">,
): ImageRequestPolicy {
  void model;
  const maxBytes = DEFAULT_REQUEST_IMAGE_MAX_BYTES;
  if (
    source === undefined ||
    !Number.isSafeInteger(source.width) ||
    !Number.isSafeInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return { maxPixels: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET, maxBytes };
  }
  const projected = requestImageTokenDimensions(source.width, source.height);
  const capped =
    Math.max(projected.width, projected.height) > REQUEST_IMAGE_MAX_DIMENSION
      ? longEdgeDimensions(
          source.width,
          source.height,
          REQUEST_IMAGE_MAX_DIMENSION,
        )
      : projected;
  return {
    maxPixels: Math.max(1, capped.width * capped.height),
    maxBytes,
  };
}

export type DeepSeekReadImageRequest = (
  ref: ImageAttachmentRef,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
) => Promise<RequestImageAttachment>;
