/** Title text normalization and UTF-8-safe truncation (XRK port of DSH session-title). */

/* eslint-disable no-control-regex -- intentional strip of terminal / C0-C1 controls */
const OSC_SEQUENCE =
  /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
const ESC_SEQUENCE = /\u001B[@-_]/gu;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
/* eslint-enable no-control-regex */
const DIRECTIONAL_CONTROL =
  /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;

const utf8 = new TextEncoder();

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function utf8ByteLength(input: string): number {
  return utf8.encode(input).length;
}

function cleanTitleText(input: string): string {
  return input
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_SEQUENCE, "")
    .replace(CONTROL_CHARACTER, "")
    .replace(DIRECTIONAL_CONTROL, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function truncateTitleUtf8(input: string, maxBytes: number): string {
  assertPositiveInteger("maxBytes", maxBytes);
  if (utf8ByteLength(input) <= maxBytes) return input;
  let used = 0;
  let output = "";
  for (const character of input) {
    const bytes = utf8ByteLength(character);
    if (used + bytes > maxBytes) break;
    output += character;
    used += bytes;
  }
  return output;
}

export function normalizeSessionTitle(input: string, maxBytes: number): string {
  return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd();
}

export function fallbackSessionTitle(
  input: string,
  maxWords: number,
  maxBytes: number,
): string {
  assertPositiveInteger("maxWords", maxWords);
  const words = cleanTitleText(input).split(" ").filter(Boolean).slice(0, maxWords);
  return truncateTitleUtf8(words.join(" "), maxBytes).trimEnd();
}

export const DEFAULT_TITLE_MAX_BYTES = 120;
export const DEFAULT_FALLBACK_MAX_WORDS = 8;
