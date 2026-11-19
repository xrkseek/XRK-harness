/**
 * Face prompt content → durable ContentBlock[] (DSH-aligned).
 * Wire may carry temporary base64; session log only stores attachment refs.
 */

import type { AttachmentStore } from "@xrkseek/attachment";
import { AttachmentError, isAttachmentError } from "@xrkseek/attachment";
import type {
  ContentBlock,
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageMediaType,
  MessageContent,
} from "@xrkseek/protocol";
import { fileUploadHandleBlock, imageHandleBlock, isImageMediaType } from "@xrkseek/protocol";

export type PromptWirePart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly mediaType: string;
      readonly data: string;
      readonly name?: string;
      /** Absolute OS path when Desktop resolved a drag/drop (not clipboard). */
      readonly sourcePath?: string;
    }
  | {
      /** Reuse bytes already in AttachmentStore (edit-resubmit / regenerate). */
      readonly type: "image";
      readonly attachmentId: string;
      /** Display leaf; local image objects omit name on read-by-id. */
      readonly name?: string;
    }
  | {
      readonly type: "file";
      readonly data: string;
      readonly name?: string;
      readonly mediaType?: string;
      /** Absolute OS path when Desktop resolved a drag/drop (not clipboard). */
      readonly sourcePath?: string;
    }
  | {
      /** Reuse bytes already in AttachmentStore (edit-resubmit / regenerate). */
      readonly type: "file";
      readonly attachmentId: string;
    };

export type DurablePromptResult =
  | { readonly ok: true; readonly content: MessageContent }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

/** Image numbering base for this message: count of images already admitted in the session. */
export type DurablePromptOptions = {
  readonly imageStartIndex?: number;
};

/** True when content has a non-text part or non-whitespace text (attachment-only OK). */
export function hasPromptContent(parts: readonly PromptWirePart[]): boolean {
  return parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "image" || part.type === "file") return true;
    return false;
  });
}

function isReusePart(
  part: PromptWirePart,
): part is
  | { readonly type: "image"; readonly attachmentId: string; readonly name?: string }
  | { readonly type: "file"; readonly attachmentId: string } {
  return (
    (part.type === "image" || part.type === "file") &&
    "attachmentId" in part &&
    typeof part.attachmentId === "string" &&
    part.attachmentId.trim().length > 0 &&
    !("data" in part)
  );
}

/** Prefer wire display name when the store object has none (image read-by-id). */
function withOptionalImageName(
  ref: ImageAttachmentRef,
  name: string | undefined,
): ImageAttachmentRef {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") return ref;
  if (ref.name !== undefined && ref.name.trim() !== "") return ref;
  return { ...ref, name: trimmed };
}

function decodeBase64(data: string): Uint8Array | undefined {
  try {
    const buf = Buffer.from(data, "base64");
    if (buf.byteLength === 0 && data.length > 0) return undefined;
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

function mapAttachmentError(err: AttachmentError): DurablePromptResult {
  return {
    ok: false,
    code: err.code.toLowerCase().replaceAll("_", "-"),
    message: err.message,
  };
}

/**
 * Build durable message content from Face `session.prompt` parts.
 * - all text → string (legacy-friendly)
 * - any image/file → ContentBlock[] after AttachmentStore admission
 */
export async function durablePromptContent(
  parts: readonly PromptWirePart[],
  attachments: AttachmentStore,
  options: DurablePromptOptions = {},
): Promise<DurablePromptResult> {
  if (parts.length === 0) {
    return { ok: false, code: "invalid-payload", message: "content required" };
  }

  const hasAttachment = parts.some(
    (p) => p.type === "image" || p.type === "file",
  );
  if (!hasAttachment) {
    const text = parts
      .filter((p): p is Extract<PromptWirePart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (!text) {
      return { ok: false, code: "invalid-payload", message: "empty text" };
    }
    return { ok: true, content: text };
  }

  type Pending =
    | { readonly kind: "text"; readonly text: string }
    | {
        readonly kind: "image";
        readonly mediaType: ImageMediaType;
        readonly data: Uint8Array;
        readonly name?: string;
        readonly sourcePath?: string;
      }
    | {
        readonly kind: "file";
        readonly data: Uint8Array;
        readonly name?: string;
        readonly mediaType?: string;
        readonly sourcePath?: string;
      }
    | { readonly kind: "reuse-image"; readonly ref: ImageAttachmentRef }
    | { readonly kind: "reuse-file"; readonly ref: FileAttachmentRef };

  const pending: Pending[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      pending.push({ kind: "text", text: part.text });
      continue;
    }
    if (isReusePart(part)) {
      try {
        if (part.type === "image") {
          const stored = await attachments.readImage(part.attachmentId.trim());
          pending.push({
            kind: "reuse-image",
            ref: withOptionalImageName(stored.ref, part.name),
          });
        } else {
          const stored = await attachments.readFile(part.attachmentId.trim());
          pending.push({ kind: "reuse-file", ref: stored.ref });
        }
      } catch (err) {
        if (isAttachmentError(err)) return mapAttachmentError(err);
        if (err instanceof AttachmentError) {
          return { ok: false, code: "attachment-error", message: err.message };
        }
        throw err;
      }
      continue;
    }
    if (part.type === "image" && "data" in part) {
      if (!isImageMediaType(part.mediaType)) {
        return {
          ok: false,
          code: "unsupported-image-type",
          message: `unsupported mediaType: ${part.mediaType}`,
        };
      }
      const data = decodeBase64(part.data);
      if (!data || data.byteLength === 0) {
        return {
          ok: false,
          code: "invalid-payload",
          message: "image data must be non-empty base64",
        };
      }
      pending.push({
        kind: "image",
        mediaType: part.mediaType,
        data,
        ...(part.name !== undefined ? { name: part.name } : {}),
        ...(part.sourcePath !== undefined
          ? { sourcePath: part.sourcePath }
          : {}),
      });
      continue;
    }
    if (part.type === "file" && "data" in part) {
      const data = decodeBase64(part.data);
      if (!data || data.byteLength === 0) {
        return {
          ok: false,
          code: "invalid-payload",
          message: "file data must be non-empty base64",
        };
      }
      pending.push({
        kind: "file",
        data,
        ...(part.name !== undefined ? { name: part.name } : {}),
        ...(part.mediaType !== undefined ? { mediaType: part.mediaType } : {}),
        ...(part.sourcePath !== undefined
          ? { sourcePath: part.sourcePath }
          : {}),
      });
      continue;
    }
    return {
      ok: false,
      code: "invalid-payload",
      message: "unknown content part",
    };
  }

  const imageInputs = pending
    .filter((p): p is Extract<Pending, { kind: "image" }> => p.kind === "image")
    .map((p) => ({
      data: p.data,
      mediaType: p.mediaType,
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.sourcePath !== undefined ? { sourcePath: p.sourcePath } : {}),
    }));
  const fileInputs = pending
    .filter((p): p is Extract<Pending, { kind: "file" }> => p.kind === "file")
    .map((p) => ({
      data: p.data,
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.mediaType !== undefined ? { mediaType: p.mediaType } : {}),
      ...(p.sourcePath !== undefined ? { sourcePath: p.sourcePath } : {}),
    }));

  let imageRefs;
  let fileRefs;
  try {
    imageRefs =
      imageInputs.length > 0
        ? await attachments.saveImages(imageInputs)
        : [];
    fileRefs =
      fileInputs.length > 0 ? await attachments.saveFiles(fileInputs) : [];
  } catch (err) {
    if (isAttachmentError(err)) return mapAttachmentError(err);
    if (err instanceof AttachmentError) {
      return { ok: false, code: "attachment-error", message: err.message };
    }
    throw err;
  }

  const blocks: ContentBlock[] = [];
  let savedImageIndex = 0;
  let savedFileIndex = 0;
  let imageOrdinal = 0;
  for (const p of pending) {
    if (p.kind === "text") {
      if (p.text.length > 0) blocks.push({ type: "text", text: p.text });
      continue;
    }
    if (p.kind === "reuse-image") {
      imageOrdinal += 1;
      const imageNo = (options.imageStartIndex ?? 0) + imageOrdinal;
      blocks.push(imageHandleBlock(imageNo, p.ref));
      blocks.push({ type: "image", attachment: p.ref });
      continue;
    }
    if (p.kind === "image") {
      const ref = imageRefs[savedImageIndex++]!;
      imageOrdinal += 1;
      const imageNo = (options.imageStartIndex ?? 0) + imageOrdinal;
      blocks.push(imageHandleBlock(imageNo, ref));
      blocks.push({ type: "image", attachment: ref });
      continue;
    }
    if (p.kind === "reuse-file") {
      blocks.push(fileUploadHandleBlock(p.ref));
      blocks.push({ type: "file", attachment: p.ref });
      continue;
    }
    const ref = fileRefs[savedFileIndex++]!;
    blocks.push(fileUploadHandleBlock(ref));
    blocks.push({ type: "file", attachment: ref });
  }

  if (blocks.length === 0) {
    return { ok: false, code: "invalid-payload", message: "empty content" };
  }
  return { ok: true, content: blocks };
}

/**
 * Session-wide image numbering base for the next admit:
 * count of durable image blocks already present in user/prompt events.
 * Stable across restarts (derived from the event log, not runtime memory).
 */
export function sessionImageStartIndex(
  events: readonly { type: string; content?: unknown }[],
): number {
  let count = 0;
  for (const ev of events) {
    if (ev.type !== "user/message" && ev.type !== "prompt/admitted") continue;
    const content = ev.content;
    if (typeof content !== "object" || content === null) continue;
    const blocks = content as readonly { type?: string; attachment?: { attachmentId?: string } }[];
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block?.type === "image" && typeof block.attachment?.attachmentId === "string") {
        count += 1;
      }
    }
  }
  return count;
}
