/**
 * Resolve Hermes-style `image_url` / `reference_image_urls` / attachment ids
 * into decoded {@link ImageGenSourceImage} rows for Provider edit calls.
 */

import type { AttachmentStore } from "@xrkseek/attachment";
import { ImageGenError, type ImageGenSourceImage } from "./types.js";

const ATTACHMENT_PREFIX = "attachment:";

function sniffMime(
  bytes: Uint8Array,
  hint?: string,
): ImageGenSourceImage["mimeType"] {
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

function parseDataUrl(url: string): ImageGenSourceImage {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/iu.exec(
    url.trim(),
  );
  if (!match) {
    throw new ImageGenError(
      "data: image_url must be image/png|jpeg|webp base64",
      "IMAGE_GEN_BAD_ARGS",
    );
  }
  const mimeHint = match[1]!.toLowerCase().replace("image/jpg", "image/jpeg");
  const bytes = Uint8Array.from(Buffer.from(match[2]!, "base64"));
  if (bytes.byteLength === 0) {
    throw new ImageGenError("empty data: image", "IMAGE_GEN_BAD_ARGS");
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
): Promise<ImageGenSourceImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageGenError(
      `invalid image_url: ${url.slice(0, 80)}`,
      "IMAGE_GEN_BAD_ARGS",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImageGenError(
      "image_url must be http(s), data:, or attachment:<id>",
      "IMAGE_GEN_BAD_ARGS",
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
    throw new ImageGenError(
      `image_url host blocked for SSRF safety: ${host}`,
      "IMAGE_GEN_BAD_ARGS",
    );
  }
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new ImageGenError(
      `image_url fetch HTTP ${res.status}`,
      "IMAGE_GEN_BACKEND",
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new ImageGenError("image_url returned empty body", "IMAGE_GEN_BAD_ARGS");
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
): Promise<ImageGenSourceImage> {
  const stored = await attachments.readImage(id);
  return {
    bytes: stored.data,
    mimeType: sniffMime(stored.data, stored.ref.mediaType),
    label: id,
  };
}

export interface ResolveImageGenReferencesOptions {
  readonly imageUrl?: string;
  readonly referenceImageUrls?: readonly string[];
  readonly referenceAttachmentIds?: readonly string[];
  readonly attachments?: AttachmentStore;
  readonly maxReferenceImages: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Collect primary `image_url` + `reference_image_urls` + attachment ids
 * (Hermes `collect_source_images` order). Throws when edit is requested but
 * `maxReferenceImages === 0`.
 */
export async function resolveImageGenReferenceImages(
  options: ResolveImageGenReferencesOptions,
): Promise<readonly ImageGenSourceImage[]> {
  const urls: string[] = [];
  const primary = options.imageUrl?.trim();
  if (primary) urls.push(primary);
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
    throw new ImageGenError(
      "This image Provider does not support reference images / edit. Omit image_url and reference_* args, or switch Provider.",
      "IMAGE_GEN_BAD_ARGS",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const out: ImageGenSourceImage[] = [];

  for (const url of urls) {
    if (out.length >= options.maxReferenceImages) break;
    if (url.startsWith("data:")) {
      out.push(parseDataUrl(url));
      continue;
    }
    if (url.startsWith(ATTACHMENT_PREFIX)) {
      const id = url.slice(ATTACHMENT_PREFIX.length).trim();
      if (!id) {
        throw new ImageGenError(
          "attachment: image_url missing id",
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      if (!options.attachments) {
        throw new ImageGenError(
          "attachment: references require Host AttachmentStore",
          "IMAGE_GEN_BAD_ARGS",
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
      throw new ImageGenError(
        "reference_attachment_ids require Host AttachmentStore",
        "IMAGE_GEN_BAD_ARGS",
      );
    }
    out.push(await loadAttachment(id, options.attachments));
  }

  if (out.length > options.maxReferenceImages) {
    throw new ImageGenError(
      `at most ${options.maxReferenceImages} reference image(s) allowed`,
      "IMAGE_GEN_BAD_ARGS",
    );
  }
  return out;
}
