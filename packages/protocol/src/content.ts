/**
 * Provider-neutral message content blocks (session log + Face wire).
 * Attachment bytes live outside the event log — only refs appear here.
 */

/** Raster formats accepted on the v1 image path. */
export type ImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

/**
 * Durable image metadata. `attachmentId` is opaque storage id
 * (e.g. `sha256:…`) — never a filesystem path or bearer URL.
 */
export interface ImageAttachmentRef {
  readonly attachmentId: string;
  readonly mediaType: ImageMediaType;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
  /** Orientation-applied dimensions before normalization scaling. */
  readonly originalDimensions?: {
    readonly width: number;
    readonly height: number;
  };
}

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ImageBlock {
  readonly type: "image";
  readonly attachment: ImageAttachmentRef;
}

/** Core blocks for user/assistant session content (v1). */
export type ContentBlock = TextBlock | ImageBlock;

/**
 * Session `user/message` / `prompt/admitted` content.
 * Legacy events use `string`; new writes prefer `ContentBlock[]`.
 */
export type MessageContent = string | readonly ContentBlock[];

const IMAGE_MEDIA = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function isImageMediaType(value: unknown): value is ImageMediaType {
  return typeof value === "string" && IMAGE_MEDIA.has(value);
}

export function isTextBlock(value: unknown): value is TextBlock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return o.type === "text" && typeof o.text === "string";
}

export function isImageAttachmentRef(
  value: unknown,
): value is ImageAttachmentRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.attachmentId === "string" &&
    o.attachmentId.length > 0 &&
    isImageMediaType(o.mediaType) &&
    typeof o.bytes === "number" &&
    Number.isFinite(o.bytes) &&
    o.bytes >= 0 &&
    typeof o.width === "number" &&
    Number.isFinite(o.width) &&
    o.width >= 0 &&
    typeof o.height === "number" &&
    Number.isFinite(o.height) &&
    o.height >= 0 &&
    (o.name === undefined || typeof o.name === "string") &&
    (o.originalDimensions === undefined ||
      (typeof o.originalDimensions === "object" &&
        o.originalDimensions !== null &&
        typeof (o.originalDimensions as { width?: unknown }).width ===
          "number" &&
        typeof (o.originalDimensions as { height?: unknown }).height ===
          "number"))
  );
}

export function isImageBlock(value: unknown): value is ImageBlock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return o.type === "image" && isImageAttachmentRef(o.attachment);
}

export function isContentBlock(value: unknown): value is ContentBlock {
  return isTextBlock(value) || isImageBlock(value);
}

export function asContentBlocks(content: MessageContent): ContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return [...content];
}

/** Concatenate text blocks; images contribute nothing (callers must gate vision). */
export function flattenText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("");
}

export function contentHasImage(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some(isImageBlock);
}

/** Collect image refs from message content (no nested tool-result yet). */
export function listImageRefs(
  content: MessageContent,
): readonly ImageAttachmentRef[] {
  if (typeof content === "string") return [];
  const out: ImageAttachmentRef[] = [];
  for (const block of content) {
    if (isImageBlock(block)) out.push(block.attachment);
  }
  return out;
}

/**
 * Merge several admits for one steer batch.
 * Strings join with blank lines; block arrays concatenate in order.
 * Mixing string + blocks promotes everything to blocks.
 */
export function mergeMessageContents(
  parts: readonly MessageContent[],
): MessageContent {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const anyBlocks = parts.some((p) => typeof p !== "string");
  if (!anyBlocks) {
    return (parts as readonly string[]).join("\n\n");
  }
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      if (part.length > 0) blocks.push({ type: "text", text: part });
      continue;
    }
    blocks.push(...part);
  }
  return blocks;
}
