/**
 * Face prompt content → durable ContentBlock[] (DSH-aligned).
 * Wire may carry temporary base64; session log only stores ImageAttachmentRef.
 */

import type { AttachmentStore } from "@xrkseek/attachment";
import { AttachmentError, isAttachmentError } from "@xrkseek/attachment";
import type {
  ContentBlock,
  ImageMediaType,
  MessageContent,
} from "@xrkseek/protocol";
import { isImageMediaType } from "@xrkseek/protocol";

export type PromptWirePart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly mediaType: string;
      readonly data: string;
      readonly name?: string;
    };

export type DurablePromptResult =
  | { readonly ok: true; readonly content: MessageContent }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

function decodeBase64(data: string): Uint8Array | undefined {
  try {
    const buf = Buffer.from(data, "base64");
    if (buf.byteLength === 0 && data.length > 0) return undefined;
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

/**
 * Build durable message content from Face `session.prompt` parts.
 * - all text → string (legacy-friendly)
 * - any image → ContentBlock[] after AttachmentStore.saveImages
 */
export async function durablePromptContent(
  parts: readonly PromptWirePart[],
  attachments: AttachmentStore,
): Promise<DurablePromptResult> {
  if (parts.length === 0) {
    return { ok: false, code: "invalid-payload", message: "content required" };
  }

  const hasImage = parts.some((p) => p.type === "image");
  if (!hasImage) {
    const text = parts
      .filter((p): p is Extract<PromptWirePart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (!text) {
      return { ok: false, code: "invalid-payload", message: "empty text" };
    }
    return { ok: true, content: text };
  }

  type Pending = {
    readonly kind: "text";
    readonly text: string;
  } | {
    readonly kind: "image";
    readonly mediaType: ImageMediaType;
    readonly data: Uint8Array;
    readonly name?: string;
  };

  const pending: Pending[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      pending.push({ kind: "text", text: part.text });
      continue;
    }
    if (part.type !== "image") {
      return {
        ok: false,
        code: "invalid-payload",
        message: "unknown content part",
      };
    }
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
    });
  }

  const imageInputs = pending
    .filter((p): p is Extract<Pending, { kind: "image" }> => p.kind === "image")
    .map((p) => ({
      data: p.data,
      mediaType: p.mediaType,
      ...(p.name !== undefined ? { name: p.name } : {}),
    }));

  let refs;
  try {
    refs = await attachments.saveImages(imageInputs);
  } catch (err) {
    if (isAttachmentError(err)) {
      return {
        ok: false,
        code: err.code.toLowerCase().replaceAll("_", "-"),
        message: err.message,
      };
    }
    if (err instanceof AttachmentError) {
      return { ok: false, code: "attachment-error", message: err.message };
    }
    throw err;
  }

  const blocks: ContentBlock[] = [];
  let imageIndex = 0;
  for (const p of pending) {
    if (p.kind === "text") {
      if (p.text.length > 0) blocks.push({ type: "text", text: p.text });
      continue;
    }
    const ref = refs[imageIndex++]!;
    blocks.push({ type: "image", attachment: ref });
  }

  if (blocks.length === 0) {
    return { ok: false, code: "invalid-payload", message: "empty content" };
  }
  return { ok: true, content: blocks };
}
