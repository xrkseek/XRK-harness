const BLOCK_TAGS = /<(script|style|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG = /<[^>]+>/g;
const BLOCK = /<\/?(p|div|br|h[1-6]|li|tr|pre|blockquote|hr|ul|ol|table|section|article|header|footer)[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      } catch {
        return "";
      }
    })
    .replace(/&([a-z]+);/gi, (all, name: string) => ENTITIES[name.toLowerCase()] ?? all);
}

/**
 * Lossy HTML → plain text. Not GFM (DSH uses turndown); enough for model
 * context without adding a DOM converter.
 */
export function htmlToText(html: string, maxChars: number): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(BLOCK_TAGS, " ")
    .replace(BLOCK, "\n")
    .replace(TAG, " ");
  const decoded = decodeEntities(stripped)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (decoded.length <= maxChars) return { text: decoded, truncated: false };
  return { text: decoded.slice(0, maxChars), truncated: true };
}

export function capText(text: string, maxChars: number): {
  readonly text: string;
  readonly truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
