/**
 * Bound oversized tool results before they enter the session log.
 * Byte ceiling is {@link TOOL_RESULT_MAX_INLINE_BYTES} (same number as
 * pipeline `boundToolOutput`). Face `agent-loop.toolResultMaxInlineBytes`
 * may raise/lower (`0` disables spill).
 *
 * Disk: one full body under `spill/tool-outputs`. Pipeline `persist` is the
 * writer when mounted. Prefer {@link boundToolResultContent}'s `savedPath`
 * (from `RunToolOutcome.outputPaths`) over parsing the inline marker — a
 * clipped marker must not trigger a second write of the truncated preview.
 * Marker regex remains a fallback when `savedPath` is absent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_TOOL_OUTPUT_MAX_BYTES } from "@xrkseek/core-tools";
import { resolveXrkHome, capSpillText, pruneSpillTree } from "@xrkseek/xrk-home-paths";
import type { MessageContent } from "@xrkseek/protocol";

/** Shared with pipeline `DEFAULT_TOOL_OUTPUT_MAX_BYTES` (UTF-8 bytes). */
export const TOOL_RESULT_MAX_INLINE_BYTES = DEFAULT_TOOL_OUTPUT_MAX_BYTES;

/** Tool-result files. Session-reference transcripts stay in `spill/<session>/`. */
function toolOutputDir(): string {
  return path.join(resolveXrkHome(), "spill", "tool-outputs");
}

/**
 * Pipeline marker (`full content saved to …`) or a previous loop notice.
 * Fallback when {@link boundToolResultContent} did not receive `savedPath`.
 */
export function alreadySavedPath(text: string): string | undefined {
  const pipeline = text.match(
    /full content saved to (.+?)(?: \.\.\.| \.\.\.$|$)/m,
  );
  const loop = text.match(/Full formatted result stored at: (.+?)\. Retrieve/);
  const loc = (pipeline?.[1] ?? loop?.[1])?.trim();
  return loc ? loc : undefined;
}

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
  /**
   * Authoritative full-body path from pipeline `outputPaths` (preferred over
   * parsing the inline marker).
   */
  readonly savedPath?: string;
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

  const saved =
    (input.savedPath?.trim() ? input.savedPath.trim() : undefined) ??
    alreadySavedPath(plain);
  const file = saved ?? writeToolOutput(input.sessionId, input.callId, plain);
  const omitted = total - maxInline;
  const notice = saved
    ? `Full formatted result stored at: ${file}. Retrieve with read_file or grep on that path.\n\n`
    : `(omitted ~${omitted} bytes. Full formatted result stored at: ${file}. ` +
      `Retrieve with read_file or grep on that path.)\n\n`;
  return { content: fitInline(notice, plain, maxInline), spilled: true };
}

function writeToolOutput(
  sessionId: string,
  callId: string,
  plain: string,
): string {
  const dir = toolOutputDir();
  pruneSpillTree(path.dirname(dir));
  mkdirSync(dir, { recursive: true });
  const safe = (value: string) => value.replace(/[^\w.-]+/g, "_");
  const file = path.join(
    dir,
    `${safe(sessionId)}_${safe(callId) || "call"}.txt`,
  );
  writeFileSync(file, capSpillText(plain), "utf8");
  return file;
}

function fitInline(notice: string, plain: string, maxInline: number): string {
  const noticeBytes = utf8Bytes(notice);
  if (noticeBytes >= maxInline) return utf8Prefix(notice, maxInline);
  let body = notice + headTail(plain, maxInline - noticeBytes);
  if (utf8Bytes(body) > maxInline) body = utf8Prefix(body, maxInline);
  return body;
}
