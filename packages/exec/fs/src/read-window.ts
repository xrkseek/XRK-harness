/**
 * Format a UTF-8 file body as a DSH-style line window for the model.
 * Lines are 1-based; LF-normalized. Footer when more lines remain.
 */

export const DEFAULT_READ_LINE_LIMIT = 2000;

export function formatReadWindow(
  text: string,
  options: {
    readonly offset?: number;
    readonly limit?: number;
  } = {},
): { readonly content: string; readonly truncated: boolean } {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  // Trailing empty from final newline is a real last line for editors; keep it.
  const total = lines.length;
  const offsetRaw = options.offset;
  const offset =
    typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw >= 1
      ? Math.floor(offsetRaw)
      : 1;
  const limitRaw = options.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : DEFAULT_READ_LINE_LIMIT;
  const startIdx = Math.min(offset - 1, total);
  const endIdx = Math.min(startIdx + limit, total);
  const slice = lines.slice(startIdx, endIdx);
  const numbered = slice.map((line, i) => `${startIdx + i + 1}|${line}`);
  const truncated = endIdx < total || offset > total;
  let content = numbered.join("\n");
  if (endIdx < total) {
    content += `\n\n[… ${total - endIdx} more lines; use offset=${endIdx + 1}]`;
  } else if (offset > total) {
    content = `(no lines at offset ${offset}; file has ${total} lines)`;
  }
  return { content, truncated };
}
