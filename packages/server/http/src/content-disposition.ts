/**
 * RFC 6266 / 5987 attachment header — Node rejects non-ASCII in header values.
 */
export function attachmentContentDisposition(filename: string): string {
  const base = filename.replace(/[\r\n]/g, "").split(/[/\\]/).pop() ?? "download";
  const asciiFallback =
    base.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(base).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
