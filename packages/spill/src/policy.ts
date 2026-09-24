/**
 * Tool-result spill policy — decides when/how to spill; storage stays on SpillStore.
 * Learned from dsh `@deepseek-ai/dsh-spill-policy` (notice · skip tools · head/tail).
 */

import type { SpillLocator, SpillRef, SpillStore } from "./types.js";
import { SpillLocator as asSpillLocator } from "./types.js";

/** Tools that must stay inline (avoid read → spill → read loops). */
export const NO_SPILL_TOOLS = new Set(["read_file", "read", "read_image"]);

/** Default inline ceiling (UTF-8 bytes); Face may override. */
export const DEFAULT_SPILL_INLINE_BYTES = 64_000;

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Prefix of `text` with at most `maxBytes` UTF-8 bytes (no mid-sequence cut). */
export function utf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8Bytes(text) <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  let out = text.slice(0, end);
  while (end > 0 && utf8Bytes(out) > maxBytes) {
    end -= 1;
    out = text.slice(0, end);
  }
  return out;
}

/** Suffix of `text` with at most `maxBytes` UTF-8 bytes. */
export function utf8Suffix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8Bytes(text) <= maxBytes) return text;
  let start = Math.max(0, text.length - maxBytes);
  let out = text.slice(start);
  while (start < text.length && utf8Bytes(out) > maxBytes) {
    start += 1;
    out = text.slice(start);
  }
  return out;
}

/** Head/tail preview: half budget each end, omit the middle. */
export function headTail(text: string, budget: number): string {
  if (utf8Bytes(text) <= budget) return text;
  const marker = "\n\n[... middle omitted ...]\n\n";
  const markerBytes = utf8Bytes(marker);
  const keep = Math.max(0, budget - markerBytes);
  const headBytes = Math.ceil(keep / 2);
  const tailBytes = Math.floor(keep / 2);
  return `${utf8Prefix(text, headBytes)}${marker}${utf8Suffix(text, tailBytes)}`;
}

/**
 * Model-facing spill notice (dsh-compatible wording).
 * Keep stable — Host timeline / UI parse the path after `stored at:`.
 */
export function formatSpillNotice(args: {
  readonly omittedBytes: number;
  readonly ref: SpillRef;
  /**
   * When the body was already persisted by pipeline `persist`, skip the
   * “(omitted ~N bytes…)” prefix so markers stay short.
   */
  readonly alreadyPersisted?: boolean;
}): string {
  const loc = String(args.ref.locator);
  const hint = args.ref.retrievalHint.trim() || "Retrieve with read_file or grep on that path.";
  if (args.alreadyPersisted) {
    return `Full formatted result stored at: ${loc}. ${hint}\n\n`;
  }
  return (
    `(omitted ~${args.omittedBytes} bytes. Full formatted result stored at: ${loc}. ` +
    `${hint})\n\n`
  );
}

/**
 * Parse a spill locator from pipeline / loop notices.
 * Prefer an authoritative `savedPath` from the tool pipeline when present.
 */
export function parseSpillLocator(text: string): SpillLocator | undefined {
  const pipeline = text.match(
    /full content saved to (.+?)(?: \.\.\.| \.\.\.$|$)/m,
  );
  const loop = text.match(/Full formatted result stored at: (.+?)\. Retrieve/);
  const loc = (pipeline?.[1] ?? loop?.[1])?.trim();
  return loc ? asSpillLocator(loc) : undefined;
}

/** @deprecated Prefer {@link parseSpillLocator}. */
export const alreadySavedPath = (text: string): string | undefined =>
  parseSpillLocator(text) as string | undefined;

export function fitInlineNotice(
  notice: string,
  plain: string,
  maxInline: number,
): string {
  const noticeBytes = utf8Bytes(notice);
  if (noticeBytes >= maxInline) return utf8Prefix(notice, maxInline);
  let body = notice + headTail(plain, maxInline - noticeBytes);
  if (utf8Bytes(body) > maxInline) body = utf8Prefix(body, maxInline);
  return body;
}

export interface ApplySpillPolicyInput {
  readonly sessionId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly plainText: string;
  /** UTF-8 inline ceiling; omit → {@link DEFAULT_SPILL_INLINE_BYTES}; `0` → no spill. */
  readonly maxInlineBytes?: number;
  /** Authoritative full-body path from pipeline `outputPaths`. */
  readonly savedPath?: string;
  readonly store: SpillStore;
}

export interface ApplySpillPolicyResult {
  readonly content: string;
  readonly spilled: boolean;
  readonly ref?: SpillRef;
}

/**
 * Apply spill policy against a {@link SpillStore}.
 * Sync when `store.saveTextSync` exists; otherwise throws (agent-loop needs sync).
 */
export function applySpillPolicy(
  input: ApplySpillPolicyInput,
): ApplySpillPolicyResult {
  if (NO_SPILL_TOOLS.has(input.toolName)) {
    return { content: input.plainText, spilled: false };
  }
  const maxInline =
    input.maxInlineBytes === undefined
      ? DEFAULT_SPILL_INLINE_BYTES
      : Math.max(0, Math.floor(input.maxInlineBytes));
  if (maxInline === 0) {
    return { content: input.plainText, spilled: false };
  }
  const total = utf8Bytes(input.plainText);
  if (total <= maxInline) {
    return { content: input.plainText, spilled: false };
  }

  const saved =
    (input.savedPath?.trim() ? input.savedPath.trim() : undefined) ??
    parseSpillLocator(input.plainText);
  let ref: SpillRef;
  let alreadyPersisted = false;
  if (saved) {
    alreadyPersisted = true;
    ref = {
      locator: asSpillLocator(saved),
      bytes: total,
      retrievalHint: "Retrieve with read_file or grep on that path.",
    };
  } else {
    if (typeof input.store.saveTextSync !== "function") {
      throw new Error(
        "SpillStore.saveTextSync is required for synchronous tool-result spill",
      );
    }
    ref = input.store.saveTextSync({
      owner: { sessionId: input.sessionId },
      source: {
        kind: "tool",
        toolName: input.toolName,
        callId: input.callId,
        label: input.toolName,
      },
      suggestedName: `${input.callId}.txt`,
      content: input.plainText,
    });
  }

  const notice = formatSpillNotice({
    omittedBytes: total - maxInline,
    ref,
    alreadyPersisted,
  });
  return {
    content: fitInlineNotice(notice, input.plainText, maxInline),
    spilled: true,
    ref,
  };
}
