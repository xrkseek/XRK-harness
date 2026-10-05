/**
 * Byte-first media type sniffing for image payloads crossing the Provider seam.
 */

import type { ImageGenSourceImage } from "./types.js";

type ImageGenMime = ImageGenSourceImage["mimeType"];

/**
 * Resolve the encoded media type of image bytes.
 *
 * Magic numbers win over `hint`. Providers and CDNs both declare a type and
 * both get it wrong: relay gateways hand WebP bodies back inside an
 * OpenAI-shaped `b64_json`, and object storage answers `application/octet-stream`
 * for a PNG. Attachment admission compares the declared type against what the
 * bytes actually decode to, so trusting the declaration rejects a perfectly
 * valid image with `IMAGE_TYPE_MISMATCH`.
 *
 * @param bytes - encoded raster; only the leading header is read.
 * @param hint - declared media type, consulted only when the header is unknown.
 * @returns one of the media types {@link ImageGenSourceImage} allows.
 */
export function sniffImageMime(bytes: Uint8Array, hint?: string): ImageGenMime {
  if (bytes.length >= 1 && bytes[0] === 0x89) return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  // Full RIFF....WEBP signature, so a RIFF/WAVE or RIFF/AVI container is not
  // mistaken for a still image.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (hint === "image/jpeg" || hint === "image/png" || hint === "image/webp") {
    return hint;
  }
  return "image/png";
}