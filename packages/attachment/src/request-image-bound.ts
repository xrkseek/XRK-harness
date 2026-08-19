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

function collectImageOccurrences(
  messages: readonly ChatMessage[],
): { msgIndex: number; blockIndex: number; bytes: number }[] {
  const out: { msgIndex: number; blockIndex: number; bytes: number }[] = [];
  for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
    const msg = messages[msgIndex]!;
    if (msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") continue;
    const blocks = asContentBlocks(content);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex]!;
      if (block.type !== "image") continue;
      out.push({
        msgIndex,
        blockIndex,
        bytes: base64PayloadBytes(block.attachment),
      });
    }
  }
  return out;
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
 * Replace oldest image occurrences until estimated base64 payload fits the bound.
 * Pure function of logged history — not a session event.
 */
export function offloadRequestImages(
  messages: readonly ChatMessage[],
  maxBytes: number = DEFAULT_MAX_REQUEST_IMAGE_BYTES,
): readonly ChatMessage[] {
  if (maxBytes <= 0) return messages;
  const occurrences = collectImageOccurrences(messages);
  let total = occurrences.reduce((sum, o) => sum + o.bytes, 0);
  if (total <= maxBytes) return messages;

  const cloned = messages.map((m) => ({ ...m }));
  const offloaded = new Set<string>();

  for (const occ of occurrences) {
    if (total <= maxBytes) break;
    const key = `${occ.msgIndex}:${occ.blockIndex}`;
    if (offloaded.has(key)) continue;
    const msg = cloned[occ.msgIndex]!;
    if (msg.role !== "user" || typeof msg.content === "string") continue;
    cloned[occ.msgIndex] = {
      ...msg,
      content: replaceImageBlock(msg.content, occ.blockIndex),
    };
    offloaded.add(key);
    total -= occ.bytes;
  }

  return cloned;
}
