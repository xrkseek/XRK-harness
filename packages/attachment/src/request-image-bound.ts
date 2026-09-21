import type { ChatMessage, MessageContent } from "@xrkseek/protocol";
import { asContentBlocks } from "@xrkseek/protocol";
import type { ImageAttachmentRef } from "./types.js";

/** Default bound for inlined base64 image payload (DSH rc.8). */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;

export const REQUEST_IMAGE_OFFLOAD_PLACEHOLDER =
  "(image omitted from request due to size limit; attach again if needed)";

function base64PayloadBytes(ref: ImageAttachmentRef): number {
  return Math.ceil((ref.bytes * 4) / 3);
}

function replaceImageBlock(
  content: MessageContent,
  blockIndex: number,
): MessageContent {
  const blocks = [...asContentBlocks(content)];
  blocks[blockIndex] = {
    type: "text",
    text: REQUEST_IMAGE_OFFLOAD_PLACEHOLDER,
  };
  return blocks;
}

/**
 * Project durable `offloaded` marks to placeholder text, then replace oldest
 * retained image occurrences until estimated base64 payload fits the bound.
 * Prefer logging `image/offload` via {@link ensureDurableImageOffloads} so
 * restore/fork keep omissions; this remains a wire safety net.
 */
export function offloadRequestImages(
  messages: readonly ChatMessage[],
  maxBytes: number = DEFAULT_MAX_REQUEST_IMAGE_BYTES,
): readonly ChatMessage[] {
  if (maxBytes <= 0) return messages;

  let cloned: ChatMessage[] | undefined;
  const ensure = (): ChatMessage[] => {
    if (!cloned) cloned = messages.map((m) => ({ ...m }));
    return cloned;
  };

  // Durable marks → placeholder text (attachment id stays in the session log).
  for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
    const msg = messages[msgIndex]!;
    if (msg.role !== "user" && msg.role !== "tool") continue;
    if (typeof msg.content === "string") continue;
    const blocks = asContentBlocks(msg.content);
    let next: typeof blocks | undefined;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex]!;
      if (block.type !== "image" || block.offloaded !== true) continue;
      next ??= [...blocks];
      next[blockIndex] = {
        type: "text",
        text: REQUEST_IMAGE_OFFLOAD_PLACEHOLDER,
      };
    }
    if (next) {
      ensure()[msgIndex] = { ...msg, content: next };
    }
  }

  const working = cloned ?? messages;
  const occurrences: { msgIndex: number; blockIndex: number; bytes: number }[] =
    [];
  for (let msgIndex = 0; msgIndex < working.length; msgIndex++) {
    const msg = working[msgIndex]!;
    if (msg.role !== "user" && msg.role !== "tool") continue;
    if (typeof msg.content === "string") continue;
    const blocks = asContentBlocks(msg.content);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex]!;
      if (block.type !== "image") continue;
      occurrences.push({
        msgIndex,
        blockIndex,
        bytes: base64PayloadBytes(block.attachment),
      });
    }
  }

  let total = occurrences.reduce((sum, o) => sum + o.bytes, 0);
  if (total <= maxBytes) return working;

  const out = ensure();
  const done = new Set<string>();
  for (const occ of occurrences) {
    if (total <= maxBytes) break;
    const key = `${occ.msgIndex}:${occ.blockIndex}`;
    if (done.has(key)) continue;
    const msg = out[occ.msgIndex]!;
    if (
      (msg.role !== "user" && msg.role !== "tool") ||
      typeof msg.content === "string"
    ) {
      continue;
    }
    out[occ.msgIndex] = {
      ...msg,
      content: replaceImageBlock(msg.content, occ.blockIndex),
    };
    done.add(key);
    total -= occ.bytes;
  }

  return out;
}
