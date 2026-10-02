/**
 * Durable image offload: log `image/offload`, project marks in deriveMessages.
 * Selections survive resume and fork with the seeded prefix.
 * Shadowed (pre-compaction) images are described by id, never re-sent.
 */

import {
  asContentBlocks,
  type ChatMessage,
  type ContentBlock,
  type ImageOffloadTarget,
  type MessageContent,
  type SessionEvent,
} from "@xrkseek/protocol";
import { readSessionEvents } from "./seq.js";
import type { SessionStore } from "./store.js";

/** Match `@xrkseek/attachment` request bound (DSH rc.8). */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Max shadowed image turns named by id after a compaction window swap.
 * Ids are text — the bound is there to keep the pointer message short, not to
 * bound vision payload (no pixels are projected any more).
 */
export const MAX_DESCRIBED_SHADOWED_IMAGES = 8;

/** True when content still carries image blocks (incl. durable offloaded marks). */
export function messageHasImageBlocks(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((b) => b.type === "image");
}

function base64PayloadBytes(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

/** Fold all `image/offload` marks: log index → selected image indexes. */
export function foldImageOffloadMarks(
  events: readonly SessionEvent[],
): ReadonlyMap<number, ReadonlySet<number>> {
  const out = new Map<number, Set<number>>();
  for (const ev of events) {
    if (ev.type !== "image/offload") continue;
    for (const target of ev.targets) {
      let set = out.get(target.seq);
      if (!set) {
        set = new Set();
        out.set(target.seq, set);
      }
      for (const index of target.imageIndexes) set.add(index);
    }
  }
  return out;
}

/**
 * Project selected image occurrences to `offloaded: true` (immutable content).
 * Indexes count every image in depth-first order, including already marked ones.
 */
export function projectOffloadedImages(
  content: MessageContent,
  indexes: ReadonlySet<number> | readonly number[] | undefined,
): MessageContent {
  if (!indexes) return content;
  const count = "size" in indexes ? indexes.size : indexes.length;
  if (count === 0) return content;
  const want = indexes instanceof Set ? indexes : new Set(indexes);
  let imageIndex = 0;
  let changed = false;
  const visit = (blocks: readonly ContentBlock[]): ContentBlock[] => {
    let next: ContentBlock[] | undefined;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      let projected = block;
      if (block.type === "image") {
        if (want.has(imageIndex) && block.offloaded !== true) {
          projected = { ...block, offloaded: true };
          changed = true;
        }
        imageIndex += 1;
      }
      if (projected !== block) {
        next ??= blocks.slice(0, i);
        next.push(projected);
      } else if (next) {
        next.push(block);
      }
    }
    return next ?? (blocks as ContentBlock[]);
  };
  if (typeof content === "string") return content;
  const projected = visit(asContentBlocks(content));
  return changed ? projected : content;
}

function contentImageBytes(content: MessageContent): {
  readonly bytes: number[];
  readonly count: number;
} {
  if (typeof content === "string") return { bytes: [], count: 0 };
  const bytes: number[] = [];
  for (const block of asContentBlocks(content)) {
    if (block.type !== "image") continue;
    bytes.push(
      block.offloaded === true ? 0 : base64PayloadBytes(block.attachment.bytes),
    );
  }
  return { bytes, count: bytes.length };
}

/**
 * Plan additional offload targets so retained (non-offloaded) image payload
 * fits `maxBytes`. Walks the log in order; skips assistant nodes.
 */
export function planImageOffloadTargets(
  events: readonly SessionEvent[],
  maxBytes: number = DEFAULT_MAX_REQUEST_IMAGE_BYTES,
): ImageOffloadTarget[] {
  if (maxBytes <= 0) return [];
  const marks = foldImageOffloadMarks(events);
  type Occ = { seq: number; imageIndex: number; bytes: number };
  const occurrences: Occ[] = [];
  let total = 0;

  for (let seq = 0; seq < events.length; seq++) {
    const ev = events[seq]!;
    if (ev.type !== "user/message" && ev.type !== "tool/result") continue;
    const content =
      ev.type === "user/message" ? ev.content : ev.result.content;
    const projected = projectOffloadedImages(content, marks.get(seq));
    const { bytes } = contentImageBytes(projected);
    for (let imageIndex = 0; imageIndex < bytes.length; imageIndex++) {
      const b = bytes[imageIndex]!;
      if (b <= 0) continue;
      occurrences.push({ seq, imageIndex, bytes: b });
      total += b;
    }
  }

  if (total <= maxBytes) return [];

  const bySeq = new Map<number, number[]>();
  for (const occ of occurrences) {
    if (total <= maxBytes) break;
    const list = bySeq.get(occ.seq) ?? [];
    list.push(occ.imageIndex);
    bySeq.set(occ.seq, list);
    total -= occ.bytes;
  }

  const targets: ImageOffloadTarget[] = [];
  for (const [seq, imageIndexes] of bySeq) {
    imageIndexes.sort((a, b) => a - b);
    targets.push({ seq, imageIndexes });
  }
  targets.sort((a, b) => a.seq - b.seq);
  return targets;
}

/**
 * Shadowed pre-compaction images, described by id instead of re-attached.
 *
 * A window swap drops the shadowed prefix to text, and the pixels used to be
 * re-projected so vision survived. That backfired twice: every subsequent turn
 * re-sent the same base64 (vision tokens on the wire for a stale screenshot),
 * and a user message carrying an image *inside the current window* reads to the
 * model as a fresh paste — which is how a single attachment turned into "the
 * user pasted this seven times" after repeated compactions. The bytes stay in
 * the log and in the attachment store, so a single line naming the ids lets the
 * model pull back exactly what it still needs via `read_image`.
 *
 * Returns at most one user message listing ids (newest turn first kept in
 * chronological order); the original turns themselves are covered by the
 * compaction summary and recent tail text.
 */
export function describeShadowedImages(
  events: readonly SessionEvent[],
  compactIndex: number,
  maxMessages: number = MAX_DESCRIBED_SHADOWED_IMAGES,
): ChatMessage[] {
  if (maxMessages <= 0 || compactIndex <= 0) return [];
  const marks = foldImageOffloadMarks(events);
  const lines: string[] = [];
  for (let seq = compactIndex - 1; seq >= 0 && lines.length < maxMessages; seq--) {
    const ev = events[seq]!;
    if (ev.type !== "user/message") continue;
    const content = projectOffloadedImages(ev.content, marks.get(seq));
    if (!messageHasImageBlocks(content)) continue;
    for (const block of asContentBlocks(content)) {
      if (block.type !== "image") continue;
      const a = block.attachment;
      lines.push(`- ${a.attachmentId} (${a.mediaType} ${a.width}x${a.height})`);
    }
  }
  if (lines.length === 0) return [];
  lines.reverse();
  return [
    {
      role: "user",
      content:
        "Images sent before this compaction were left behind and are NOT " +
        "re-attached (re-sending them costs vision tokens on every turn). " +
        "They are still readable on demand with " +
        "`read_image file_path=<attachmentId>`:\n" +
        lines.join("\n"),
    },
  ];
}

/**
 * Append one `image/offload` when the current log would exceed the request
 * image budget. Returns whether an event was written (caller should re-read).
 */
export function ensureDurableImageOffloads(
  store: SessionStore,
  sessionId: string,
  maxBytes: number = DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  now: () => number = () => Date.now(),
): boolean {
  const events = readSessionEvents(store, sessionId);
  const targets = planImageOffloadTargets(events, maxBytes);
  if (targets.length === 0) return false;
  store.append(sessionId, {
    type: "image/offload",
    ts: now(),
    targets,
  });
  return true;
}
