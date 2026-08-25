/**
 * Bound oversized tool results before they enter the session log.
 * Mirrors DSH spill-policy + TextRetainer headTail: full body on disk,
 * model sees head/tail preview + locator notice. Kernel default is always-on
 * at {@link TOOL_RESULT_MAX_INLINE_BYTES}; Face `agent-loop.toolResultMaxInlineBytes`
 * may raise/lower (`0` disables spill).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { MessageContent } from "@xrkseek/protocol";

/** DSH bash / spill-policy inline ceiling (UTF-8 bytes). */
export const TOOL_RESULT_MAX_INLINE_BYTES = 64_000;

const SPILL_ROOT = path.join(homedir(), ".xrk", "spill");

/** Tools that must stay inline (DSH skips `read` to avoid read → spill → read). */
const NO_SPILL = new Set(["read_file", "read", "read_image"]);

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Prefix of `text` with at most `maxBytes` UTF-8 bytes (no mid-sequence cut). */
function utf8Prefix(text: string, maxBytes: number): string {
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
function utf8Suffix(text: string, maxBytes: number): string {
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

/** DSH TextRetainer headTail: half budget each end, omit the middle. */
function headTail(text: string, budget: number): string {
  if (utf8Bytes(text) <= budget) return text;
  const marker = "\n\n[... middle omitted ...]\n\n";
  const markerBytes = utf8Bytes(marker);
  const keep = Math.max(0, budget - markerBytes);
  const headBytes = Math.ceil(keep / 2);
  const tailBytes = Math.floor(keep / 2);
  const head = utf8Prefix(text, headBytes);
  const tail = utf8Suffix(text, tailBytes);
  return `${head}${marker}${tail}`;
}

function plainText(content: MessageContent): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type !== "text") return undefined;
    parts.push(block.text);
  }
  return parts.join("\n");
}

/**
 * Spill plain-text tool output over `maxInlineBytes` (default
 * {@link TOOL_RESULT_MAX_INLINE_BYTES}). `0` disables spill.
 * Mixed content and read tools pass through unchanged.
 */
export function boundToolResultContent(input: {
  readonly sessionId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly content: MessageContent;
  /** UTF-8 inline ceiling; omit → 64_000; `0` → no spill. */
  readonly maxInlineBytes?: number;
}): { readonly content: MessageContent; readonly spilled: boolean } {
  if (NO_SPILL.has(input.toolName)) {
    return { content: input.content, spilled: false };
  }
  const maxInline =
    input.maxInlineBytes === undefined
      ? TOOL_RESULT_MAX_INLINE_BYTES
      : Math.max(0, Math.floor(input.maxInlineBytes));
  if (maxInline === 0) {
    return { content: input.content, spilled: false };
  }
  const plain = plainText(input.content);
  if (plain === undefined) {
    return { content: input.content, spilled: false };
  }
  const total = utf8Bytes(plain);
  if (total <= maxInline) {
    return { content: input.content, spilled: false };
  }

  const sessionDir = path.join(
    SPILL_ROOT,
    input.sessionId.replace(/[^\w.-]+/g, "_"),
  );
  mkdirSync(sessionDir, { recursive: true });
  const file = path.join(
    sessionDir,
    `${input.callId.replace(/[^\w.-]+/g, "_") || "call"}.txt`,
  );
  writeFileSync(file, plain, "utf8");

  const omitted = total - maxInline;
  const notice =
    `(omitted ~${omitted} bytes. Full formatted result stored at: ${file}. ` +
    `Retrieve with read_file or grep on that path.)\n\n`;
  const noticeBytes = utf8Bytes(notice);
  if (noticeBytes >= maxInline) {
    return {
      content: utf8Prefix(notice, maxInline),
      spilled: true,
    };
  }
  const preview = headTail(plain, maxInline - noticeBytes);
  let body = notice + preview;
  if (utf8Bytes(body) > maxInline) {
    body = utf8Prefix(body, maxInline);
  }
  return { content: body, spilled: true };
}
