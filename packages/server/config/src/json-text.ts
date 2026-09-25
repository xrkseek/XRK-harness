/**
 * Strip a leading UTF-8 BOM (`U+FEFF`).
 * Windows editors / PowerShell `Set-Content` often write one; `JSON.parse` rejects it.
 */
export function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** `JSON.parse` after stripping a leading UTF-8 BOM. */
export function parseJsonText(text: string): unknown {
  return JSON.parse(stripUtf8Bom(text));
}
