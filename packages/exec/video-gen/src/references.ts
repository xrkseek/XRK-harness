/**
 * Resolve Hermes-style `image_url` / `first_frame` / `reference_image_urls` /
 * attachment ids into decoded {@link VideoGenSourceImage} rows for i2v.
 */

import type { AttachmentStore } from "@xrkseek/attachment";
import { VideoGenError, type VideoGenSourceImage } from "./types.js";

const ATTACHMENT_PREFIX = "attachment:";

function sniffMime(
  bytes: Uint8Array,
  hint?: string,
): VideoGenSourceImage["mimeType"] {
  if (hint === "image/jpeg" || hint === "image/png" || hint === "image/webp") {
    return hint;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return "image/webp";
  }
  return "image/png";
}

function parseDataUrl(url: string): VideoGenSourceImage {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/iu.exec(
    url.trim(),
  );
  if (!match) {
    throw new VideoGenError(
      "data: image_url must be image/png|jpeg|webp base64",
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  const mimeHint = match[1]!.toLowerCase().replace("image/jpg", "image/jpeg");
  const bytes = Uint8Array.from(Buffer.from(match[2]!, "base64"));
  if (bytes.byteLength === 0) {
    throw new VideoGenError("empty data: image", "VIDEO_GEN_BAD_ARGS");
  }
  return {
    bytes,
    mimeType: sniffMime(bytes, mimeHint),
    label: "data-url",
  };
}

async function fetchHttpImage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<VideoGenSourceImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VideoGenError(
      `invalid image_url: ${url.slice(0, 80)}`,
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new VideoGenError(
      "image_url must be http(s), data:, or attachment:<id>",
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  // Block obvious loopback / link-local SSRF (Hermes-style safety floor).
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.startsWith("169.254.") ||
    host.startsWith("10.") ||
    /^192\.168\./u.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./u.test(host)
  ) {
    throw new VideoGenError(
      `image_url host blocked for SSRF safety: ${host}`,
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new VideoGenError(
      `image_url fetch HTTP ${res.status}`,
      "VIDEO_GEN_BACKEND",
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new VideoGenError("image_url returned empty body", "VIDEO_GEN_BAD_ARGS");
  }
  const ct = res.headers.get("content-type")?.split(";")[0]?.trim();
  return {
    bytes: buf,
    mimeType: sniffMime(buf, ct),
    label: parsed.pathname.split("/").pop() || "http-image",
  };
}

async function loadAttachment(
  id: string,
  attachments: AttachmentStore,
): Promise<VideoGenSourceImage> {
  const stored = await attachments.readImage(id);
  return {
    bytes: stored.data,
    mimeType: sniffMime(stored.data, stored.ref.mediaType),
    label: id,
  };
}

export interface ResolveVideoGenReferencesOptions {
  /** Hermes / OpenAI first-frame alias. */
  readonly firstFrame?: string;
  /** Hermes `image_url` (same schemes as first_frame). */
  readonly imageUrl?: string;
  readonly referenceImageUrls?: readonly string[];
  readonly referenceAttachmentIds?: readonly string[];
  readonly attachments?: AttachmentStore;
  readonly maxReferenceImages: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Collect `first_frame` / `image_url` + refs + attachment ids.
 * First non-empty of first_frame / image_url is the primary still (OpenAI
 * `input_reference`). Throws when i2v is requested but maxReferenceImages === 0.
 */
export async function resolveVideoGenReferenceImages(
  options: ResolveVideoGenReferencesOptions,
): Promise<readonly VideoGenSourceImage[]> {
  const urls: string[] = [];
  const primary =
    options.firstFrame?.trim() || options.imageUrl?.trim() || "";
  if (primary) urls.push(primary);
  // If both first_frame and image_url were set and differ, keep the second as a ref.
  const imageUrl = options.imageUrl?.trim();
  const firstFrame = options.firstFrame?.trim();
  if (firstFrame && imageUrl && firstFrame !== imageUrl) {
    urls.push(imageUrl);
  }
  for (const raw of options.referenceImageUrls ?? []) {
    const u = String(raw ?? "").trim();
    if (u) urls.push(u);
  }
  const attachmentIds = (options.referenceAttachmentIds ?? [])
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0);

  if (urls.length === 0 && attachmentIds.length === 0) {
    return [];
  }
  if (options.maxReferenceImages <= 0) {
    throw new VideoGenError(
      "This video Provider does not support first-frame / reference images (i2v). Omit first_frame, image_url and reference_* args, or switch Provider.",
      "VIDEO_GEN_BAD_ARGS",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const out: VideoGenSourceImage[] = [];

  for (const url of urls) {
    if (out.length >= options.maxReferenceImages) break;
    if (url.startsWith("data:")) {
      out.push(parseDataUrl(url));
      continue;
    }
    if (url.startsWith(ATTACHMENT_PREFIX)) {
      const id = url.slice(ATTACHMENT_PREFIX.length).trim();
      if (!id) {
        throw new VideoGenError(
          "attachment: image_url missing id",
          "VIDEO_GEN_BAD_ARGS",
        );
      }
      if (!options.attachments) {
        throw new VideoGenError(
          "attachment: references require Host AttachmentStore",
          "VIDEO_GEN_BAD_ARGS",
        );
      }
      out.push(await loadAttachment(id, options.attachments));
      continue;
    }
    out.push(await fetchHttpImage(url, fetchImpl));
  }

  for (const id of attachmentIds) {
    if (out.length >= options.maxReferenceImages) break;
    if (!options.attachments) {
      throw new VideoGenError(
        "reference_attachment_ids require Host AttachmentStore",
        "VIDEO_GEN_BAD_ARGS",
      );
    }
    out.push(await loadAttachment(id, options.attachments));
  }

  if (out.length > options.maxReferenceImages) {
    throw new VideoGenError(
      `at most ${options.maxReferenceImages} reference image(s) allowed`,
      "VIDEO_GEN_BAD_ARGS",
    );
  }
  return out;
}
