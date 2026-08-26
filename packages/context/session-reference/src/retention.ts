/** Byte-bounded retention for projected cross-session conversation snapshots. */

import { TextRetainer } from "@xrkseek/xrk-output-retention";
import { stringifyTagSafeJson } from "./serialization.js";
import type { ReferencedConversationItem } from "./types.js";

/** Projected row with retention bookkeeping (not serialized to the model envelope). */
export interface ProjectedConversationItem extends ReferencedConversationItem {
  readonly checkpoint: boolean;
  readonly originalText: string;
  omittedBytes: number;
}

/** Snapshot data serialized inside the untrusted prompt. */
export interface ReferencedSessionData {
  readonly sessionId: string;
  readonly label: string;
  readonly cwd: string | null;
  readonly capturedThroughSeq: number | null;
  readonly conversation: readonly ReferencedConversationItem[];
}

/** Retention facts stored beside the durable context. */
export interface ReferenceRetentionStats {
  readonly compacted: boolean;
  readonly originalMessages: number;
  readonly retainedMessages: number;
  readonly omittedMessages: number;
  readonly omittedBytes: number;
  readonly truncated: boolean;
}

/** Fixed envelope fields shared by Cordis and Face retention paths. */
export interface ReferencedSessionEnvelope {
  readonly sessionId: string;
  readonly label: string;
  readonly cwd: string | null;
  readonly capturedThroughSeq: number | null;
}

/**
 * Fit projected conversation rows into an exact rendered JSON-object byte cap.
 * Drops older non-checkpoint messages first, then truncates the longest row
 * using {@link TextRetainer} head/tail retention with an omission notice.
 */
export function retainProjectedConversation(
  envelope: ReferencedSessionEnvelope,
  projected: readonly ProjectedConversationItem[],
  maxBytes: number,
): { data: ReferencedSessionData; stats: ReferenceRetentionStats } | undefined {
  const original = projected.map((item) => ({ ...item }));
  const retained = original.map((item) => ({ ...item }));
  let omittedMessages = 0;
  let droppedOmittedBytes = 0;

  const data = (): ReferencedSessionData => ({
    sessionId: envelope.sessionId,
    label: envelope.label,
    cwd: envelope.cwd,
    capturedThroughSeq: envelope.capturedThroughSeq,
    conversation: retained.map(({ role, text }) => ({ role, text })),
  });
  const size = (): number =>
    Buffer.byteLength(stringifyTagSafeJson(data()), "utf8");

  while (size() > maxBytes) {
    const newestIndex = retained.length - 1;
    const dropIndex = retained.findIndex(
      (item, index) => !item.checkpoint && index !== newestIndex,
    );
    if (dropIndex < 0) break;
    const removed = retained.splice(dropIndex, 1)[0];
    if (removed === undefined) {
      throw new Error("session-reference retention selected a missing message");
    }
    omittedMessages += 1;
    droppedOmittedBytes += Buffer.byteLength(removed.originalText, "utf8");
  }

  while (size() > maxBytes) {
    let longestIndex = -1;
    let longestBytes = 0;
    for (const [index, item] of retained.entries()) {
      const bytes = Buffer.byteLength(item.text, "utf8");
      if (bytes > longestBytes) {
        longestBytes = bytes;
        longestIndex = index;
      }
    }
    if (longestIndex < 0 || longestBytes === 0) return undefined;
    const overflow = size() - maxBytes;
    const target = Math.max(0, longestBytes - overflow);
    const item = retained[longestIndex];
    if (item === undefined) {
      throw new Error(
        "session-reference retention selected a missing longest message",
      );
    }
    const shortened = truncateWithNotice(item.originalText, target);
    if (shortened.text === retained[longestIndex]?.text) return undefined;
    retained[longestIndex] = {
      ...item,
      text: shortened.text,
      omittedBytes: shortened.omittedBytes,
    };
  }

  const compacted = original.some((item) => item.checkpoint);
  const retainedOmittedBytes = retained.reduce(
    (sum, item) => sum + item.omittedBytes,
    0,
  );
  const omittedBytes = retainedOmittedBytes + droppedOmittedBytes;
  return {
    data: data(),
    stats: {
      compacted,
      originalMessages: original.length,
      retainedMessages: retained.length,
      omittedMessages,
      omittedBytes,
      truncated: omittedMessages > 0 || omittedBytes > 0,
    },
  };
}

function truncateWithNotice(
  text: string,
  maxOutputBytes: number,
): { text: string; omittedBytes: number } {
  if (Buffer.byteLength(text, "utf8") <= maxOutputBytes) {
    return { text, omittedBytes: 0 };
  }
  let low = 0;
  let high = maxOutputBytes;
  let best = { text: "", omittedBytes: Buffer.byteLength(text, "utf8") };
  while (low <= high) {
    const retainedBytes = Math.floor((low + high) / 2);
    const headBytes = Math.ceil(retainedBytes / 2);
    const tailBytes = Math.floor(retainedBytes / 2);
    const retainer = new TextRetainer({
      kind: "headTail",
      headBytes,
      tailBytes,
    });
    retainer.push(text);
    const result = retainer.finish();
    if (result.omittedBytes.kind !== "exact") {
      throw new Error(
        "session-reference retention did not report exact omitted bytes",
      );
    }
    const omitted = result.omittedBytes.count;
    const candidate = `${result.text}\n[… omitted ${omitted} UTF-8 bytes …]`;
    if (Buffer.byteLength(candidate, "utf8") <= maxOutputBytes) {
      best = { text: candidate, omittedBytes: omitted };
      low = retainedBytes + 1;
    } else {
      high = retainedBytes - 1;
    }
  }
  return best;
}
