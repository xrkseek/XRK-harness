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

/**
 * Durable generic-file metadata. Bytes live in AttachmentStore;
 * `attachmentId` is opaque (e.g. `sha256:…`) — never a filesystem path or URL.
 */
export interface FileAttachmentRef {
  readonly attachmentId: string;
  /** Sanitized display name (leaf only; never a path). */
  readonly name: string;
  readonly bytes: number;
  /** Browser/provider MIME when known; optional. */
  readonly mediaType?: string;
}

export interface FileBlock {
  readonly type: "file";
  readonly attachment: FileAttachmentRef;
}

/** Core blocks for user/assistant session content (v1 + generic files). */
export type ContentBlock = TextBlock | ImageBlock | FileBlock;

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

export function isFileAttachmentRef(
  value: unknown,
): value is FileAttachmentRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.attachmentId === "string" &&
    o.attachmentId.length > 0 &&
    typeof o.name === "string" &&
    o.name.length > 0 &&
    !o.name.includes("/") &&
    !o.name.includes("\\") &&
    typeof o.bytes === "number" &&
    Number.isFinite(o.bytes) &&
    o.bytes >= 0 &&
    (o.mediaType === undefined || typeof o.mediaType === "string")
  );
}

export function isFileBlock(value: unknown): value is FileBlock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return o.type === "file" && isFileAttachmentRef(o.attachment);
}

export function isContentBlock(value: unknown): value is ContentBlock {
  return isTextBlock(value) || isImageBlock(value) || isFileBlock(value);
}

export function asContentBlocks(content: MessageContent): ContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return [...content];
}

/**
 * Concatenate text blocks; images contribute nothing (callers must gate vision).
 * File blocks become deterministic handle text (path optional — see {@link fileHandleText}).
 */
export function flattenText(content: MessageContent): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (isTextBlock(block)) {
      parts.push(block.text);
      continue;
    }
    if (isFileBlock(block)) {
      parts.push(fileHandleText(block.attachment, undefined));
    }
  }
  return parts.join("");
}

function quotedLeaf(name: string): string {
  return `'${name.replaceAll("'", "\\'")}'`;
}

/**
 * Deterministic model-visible handle for one uploaded file (DSH-shaped).
 * When `readonlyPath` is set, instruct the model to use existing file tools.
 */
export function fileHandleText(
  ref: FileAttachmentRef,
  readonlyPath: string | undefined,
): string {
  const digest = String(ref.attachmentId).slice(
    "sha256:".length,
    "sha256:".length + 8,
  );
  const identity = `File ${quotedLeaf(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
  if (readonlyPath === undefined) {
    return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
  }
  return `[${identity}: verbatim read-only copy saved at ${quotedLeaf(readonlyPath)}. Read that path with your file tools (e.g. read_file) when its contents are needed; copy it to a writable location before modifying it.]`;
}

/**
 * Replace every top-level file block with handle text for LLM request assembly.
 * @param content - user/tool message content.
 * @param resolvePath - host/execution path for one ref (undefined → no-path handle).
 */
export function projectFileContentToText(
  content: MessageContent,
  resolvePath: (ref: FileAttachmentRef) => string | undefined,
): MessageContent {
  if (typeof content === "string") return content;
  if (!content.some(isFileBlock)) return content;
  return content.map((block) =>
    isFileBlock(block)
      ? {
          type: "text" as const,
          text: fileHandleText(block.attachment, resolvePath(block.attachment)),
        }
      : block,
  );
}

/**
 * Project durable file history into handle text before model routes.
 * @param messages - assembled chat history.
 * @param resolvePath - resolve one reference's current execution-world read path.
 */
export function projectFilesToText(
  messages: readonly import("./messages.js").ChatMessage[],
  resolvePath: (ref: FileAttachmentRef) => string | undefined,
): readonly import("./messages.js").ChatMessage[] {
  let changed = false;
  const out = messages.map((message) => {
    if (message.role !== "user" && message.role !== "tool") return message;
    const next = projectFileContentToText(message.content, resolvePath);
    if (next === message.content) return message;
    changed = true;
    return { ...message, content: next };
  });
  return changed ? out : messages;
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

/** Collect generic-file refs from message content. */
export function listFileRefs(
  content: MessageContent,
): readonly FileAttachmentRef[] {
  if (typeof content === "string") return [];
  const out: FileAttachmentRef[] = [];
  for (const block of content) {
    if (isFileBlock(block)) out.push(block.attachment);
  }
  return out;
}

export function contentHasFile(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some(isFileBlock);
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
