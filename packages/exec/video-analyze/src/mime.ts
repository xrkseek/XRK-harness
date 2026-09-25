/** Hermes-aligned video MIME map and size caps. */

import { VideoAnalyzeError } from "./types.js";

/** Extension → MIME. avi/mkv fall back to mp4 (Hermes). */
export const VIDEO_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/mp4",
  ".mkv": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
};

/** Soft warn threshold (Hermes logs above this). */
export const VIDEO_SIZE_WARN_BYTES = 20 * 1024 * 1024;

/** Hard cap for download / base64 payload (Hermes 50 MB). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function videoMimeForPath(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return undefined;
  return VIDEO_MIME_BY_EXT[lower.slice(dot)];
}

export function unsupportedVideoFormatMessage(suffix: string): string {
  return (
    `Unsupported video format: '${suffix}'. Supported: ` +
    `${Object.keys(VIDEO_MIME_BY_EXT).sort().join(", ")}`
  );
}

export function assertVideoByteBudget(byteLength: number): void {
  if (byteLength <= 0) {
    throw new VideoAnalyzeError(
      "Video bytes must be non-empty.",
      "VIDEO_ANALYZE_BAD_ARGS",
    );
  }
  if (byteLength > MAX_VIDEO_BYTES) {
    throw new VideoAnalyzeError(
      `Video too large: ${(byteLength / (1024 * 1024)).toFixed(1)} MB ` +
        `(limit ${MAX_VIDEO_BYTES / (1024 * 1024)} MB). Compress or trim and retry.`,
      "VIDEO_ANALYZE_TOO_LARGE",
    );
  }
}

/** Hermes prompt wrap: full description first, then the caller's question. */
export function wrapVideoAnalyzePrompt(question: string): string {
  const q = question.trim();
  return (
    "Fully describe and explain everything happening in this video, " +
    "including visual content, motion, audio cues, text overlays, and scene " +
    `transitions. Then answer the following question:\n\n${q}`
  );
}
