/**
 * Turn PDF / DOCX / XLSX / ipynb bytes into text for `FsService.read`.
 * Same tool name (`read_file`). Invalid packages return undefined so the
 * caller keeps the plain UTF-8 path.
 */
import { inflateRawSync, inflateSync } from "node:zlib";
import path from "node:path";

export const DOCUMENT_EXTRACT_MAX_BYTES = 50 * 1024 * 1024;
const MAX_XLSX_ROWS = 5000;
const MAX_XLSX_COLS = 256;
const MAX_NOTEBOOK_OUTPUT_CHARS = 20_000;

const EXTRACT_EXT = new Set([".pdf", ".docx", ".xlsx", ".ipynb"]);

export function isDocumentExtractPath(userPath: string): boolean {
  const ext = path.extname(userPath.replace(/\\/g, "/")).toLowerCase();
  return EXTRACT_EXT.has(ext);
}

/** Convert a supported document, or undefined when it is not that format. */
export function extractDocumentText(
  data: Buffer,
  userPath: string,
): string | undefined {
  if (data.byteLength > DOCUMENT_EXTRACT_MAX_BYTES) {
    throw new Error(
      `Document too large to convert (${data.byteLength} bytes, limit is ${DOCUMENT_EXTRACT_MAX_BYTES})`,
    );
  }
  const ext = path.extname(userPath.replace(/\\/g, "/")).toLowerCase();
  if (ext === ".ipynb") return extractNotebook(data);
  if (ext === ".docx") return extractDocx(data);
  if (ext === ".xlsx") return extractXlsx(data);
  if (ext === ".pdf") return extractPdf(data);
  return undefined;
}

export function textFromReadBuffer(
  buf: Buffer,
  userPath: string,
  maxBytes: number,
): { content: string; truncated?: boolean } {
  if (isDocumentExtractPath(userPath)) {
    const extracted = extractDocumentText(buf, userPath);
    if (extracted !== undefined) {
      return clipUtf8(extracted, maxBytes);
    }
  }
  return clipUtf8(buf.toString("utf8"), maxBytes);
}

function clipUtf8(
  text: string,
  maxBytes: number,
): { content: string; truncated?: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return { content: text };
  return {
    content: bytes.subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function unzip(buf: Buffer): Map<string, Buffer> | undefined {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      return undefined;
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      return undefined;
    }
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtra = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtra;
    const comp = buf.subarray(dataOff, dataOff + compSize);
    let body: Buffer;
    if (method === 0) body = Buffer.from(comp);
    else if (method === 8) {
      try {
        body = inflateRawSync(comp);
      } catch {
        return undefined;
      }
    } else continue;
    out.set(name.replace(/\\/g, "/"), body);
  }
  return out;
}

function extractNotebook(data: Buffer): string | undefined {
  let nb: unknown;
  try {
    nb = JSON.parse(data.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!nb || typeof nb !== "object") return undefined;
  const root = nb as { cells?: unknown; worksheets?: unknown };
  const cells: unknown[] = [];
  if (Array.isArray(root.cells)) cells.push(...root.cells);
  else if (Array.isArray(root.worksheets)) {
    for (const ws of root.worksheets) {
      if (ws && typeof ws === "object" && Array.isArray((ws as { cells?: unknown }).cells)) {
        cells.push(...((ws as { cells: unknown[] }).cells));
      }
    }
  }
  if (cells.length === 0) return "Notebook contains no cells\n";
  const labels: Record<string, string> = {
    markdown: "Markdown",
    code: "Code",
    raw: "Raw",
  };
  const counts: Record<string, number> = { markdown: 0, code: 0, raw: 0 };
  const lines: string[] = [];
  for (const cell of cells) {
    if (!cell || typeof cell !== "object") continue;
    const row = cell as { cell_type?: unknown; source?: unknown; outputs?: unknown };
    const typ = typeof row.cell_type === "string" ? row.cell_type : "";
    if (!(typ in labels)) continue;
    counts[typ] = (counts[typ] ?? 0) + 1;
    const suffix = typ === "raw" ? "" : ` ${counts[typ]}`;
    lines.push(`# ── ${labels[typ]} cell${suffix} ──`, sourceText(row.source).replace(/\n$/, ""), "");
    if (typ === "code") {
      const rendered = notebookOutputs(row.outputs);
      if (rendered) {
        lines.push(`# ── Output (cell ${counts[typ]}) ──`, rendered.replace(/\n$/, ""), "");
      }
    }
  }
  if (lines.length === 0) return "Notebook contains no readable cells\n";
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function sourceText(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source)) return source.map((p) => String(p)).join("");
  return "";
}

function notebookOutputs(outputs: unknown): string {
  if (!Array.isArray(outputs)) return "";
  const chunks: string[] = [];
  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    const row = output as { text?: unknown; data?: unknown };
    if (row.text !== undefined) chunks.push(sourceText(row.text));
    const data = row.data;
    if (data && typeof data === "object" && "text/plain" in data) {
      chunks.push(sourceText(data["text/plain"]));
    }
  }
  const joined = chunks.join("\n").trim();
  if (joined.length <= MAX_NOTEBOOK_OUTPUT_CHARS) return joined;
  return `${joined.slice(0, MAX_NOTEBOOK_OUTPUT_CHARS)}\n… [notebook output truncated]`;
}

function extractDocx(data: Buffer): string | undefined {
  const zip = unzip(data);
  const xml = zip?.get("word/document.xml")?.toString("utf8");
  if (!xml) return undefined;
  const paras = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const para of paras) {
    const noRuby = para.replace(/<w:rt\b[^>]*>[\s\S]*?<\/w:rt>/g, "");
    const bits: string[] = [];
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noRuby))) {
      if (m[1] !== undefined) bits.push(decodeXml(m[1]));
      else if (m[0].includes(":tab")) bits.push("\t");
      else bits.push("\n");
    }
    if (bits.length > 0) lines.push(...bits.join("").split("\n"));
  }
  if (lines.every((line) => line.trim() === "")) {
    return "DOCX contains no extractable text\n";
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function extractXlsx(data: Buffer): string | undefined {
  const zip = unzip(data);
  const workbook = zip?.get("xl/workbook.xml")?.toString("utf8");
  if (!zip || !workbook) return undefined;
  const shared = sharedStrings(zip.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  const rels = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relMap = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"|<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g;
  let rel: RegExpExecArray | null;
  while ((rel = relRe.exec(rels))) {
    const id = rel[1] || rel[4] || "";
    const target = rel[2] || rel[3] || "";
    if (id) relMap.set(id, target);
  }
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)];
  const blocks: string[] = [];
  for (const sheet of sheets) {
    const attrs = sheet[1] ?? "";
    if (/\bstate="(?:hidden|veryHidden)"/.test(attrs)) continue;
    const name = /(?:\bname=")([^"]*)/.exec(attrs)?.[1] ?? "Sheet";
    const id = /\br:id="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const target = (relMap.get(id) ?? "").replace(/^\/+/, "");
    const part = target.startsWith("xl/") ? target : `xl/${target}`;
    const xml = zip.get(part)?.toString("utf8");
    if (!xml) continue;
    const rows = sheetRows(xml, shared);
    blocks.push(`# ── Sheet: ${decodeXml(name)} ──`);
    blocks.push(...(rows.length ? rows.map((row) => row.join("\t")) : ["(empty)"]));
    blocks.push("");
  }
  if (blocks.length === 0) return "XLSX has no visible sheets with content\n";
  return `${blocks.join("\n").replace(/\n+$/, "")}\n`;
}

function sharedStrings(xml: string): string[] {
  if (!xml) return [];
  const noPh = xml.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
  const out: string[] = [];
  const si = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = si.exec(noPh))) {
    const texts = [...(m[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(
      (t) => decodeXml(t[1] ?? ""),
    );
    out.push(texts.join(""));
  }
  return out;
}

function sheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(xml)) && rows.length < MAX_XLSX_ROWS) {
    const cells = new Map<number, string>();
    let maxCol = -1;
    let next = 0;
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cell: RegExpExecArray | null;
    while ((cell = cellRe.exec(row[1] ?? ""))) {
      const attrs = cell[1] || cell[3] || "";
      const inner = cell[2] ?? "";
      const ref = /\br="([A-Za-z]+)/.exec(attrs)?.[1];
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      if (col >= MAX_XLSX_COLS) continue;
      cells.set(col, cellValue(attrs, inner, shared));
      if (col > maxCol) maxCol = col;
    }
    const line: string[] = [];
    for (let i = 0; i <= maxCol; i++) line.push(cells.get(i) ?? "");
    rows.push(line);
  }
  while (rows.length > 0 && rows[rows.length - 1]!.every((v) => v.trim() === "")) {
    rows.pop();
  }
  return rows;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(n - 1, 0);
}

function cellValue(attrs: string, inner: string, shared: readonly string[]): string {
  const typ = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
  if (typ === "s") {
    const i = Number(value);
    return Number.isInteger(i) ? (shared[i] ?? "") : "";
  }
  if (typ === "inlineStr") {
    return [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((m) => decodeXml(m[1] ?? ""))
      .join("");
  }
  if (typ === "b") return value.trim() === "1" || value.trim().toLowerCase() === "true" ? "TRUE" : "FALSE";
  if (typ === "e") return value || "#ERROR";
  return decodeXml(value);
}

function extractPdf(data: Buffer): string | undefined {
  if (!data.subarray(0, 5).toString("latin1").startsWith("%PDF")) return undefined;
  const pieces: string[] = [];
  const src = data.toString("latin1");
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    let body: Buffer = Buffer.from(src.slice(start, end), "latin1");
    if (body[body.length - 1] === 0x0a) body = body.subarray(0, -1);
    if (body[body.length - 1] === 0x0d) body = body.subarray(0, -1);
    const header = src.slice(Math.max(0, m.index - 400), m.index);
    if (header.includes("FlateDecode")) {
      body = inflatePdf(body) ?? body;
    }
    pieces.push(...pdfShowStrings(body.toString("latin1")));
    re.lastIndex = end + "endstream".length;
  }
  // NUL padding shows up in decoded PDF streams and is never display text.
  // eslint-disable-next-line no-control-regex
  const text = pieces.join("\n").replace(/\u0000/g, "").trim();
  if (!text) {
    return "[PDF has no extractable text layer. Scanned pages are not included.]\n";
  }
  return `${text}\n`;
}

function inflatePdf(body: Buffer): Buffer | undefined {
  try {
    return inflateSync(body);
  } catch {
    try {
      return inflateRawSync(body);
    } catch {
      return undefined;
    }
  }
}

function pdfShowStrings(src: string): string[] {
  const out: string[] = [];
  const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tj.exec(src))) out.push(decodePdfLiteral(m[1] ?? ""));
  const arr = /\[([\s\S]*?)\]\s*TJ/g;
  while ((m = arr.exec(src))) {
    const parts: string[] = [];
    const inner = /\(((?:\\.|[^\\)])*)\)/g;
    let s: RegExpExecArray | null;
    while ((s = inner.exec(m[1] ?? ""))) parts.push(decodePdfLiteral(s[1] ?? ""));
    if (parts.length) out.push(parts.join(""));
  }
  return out.filter((s) => s.length > 0);
}

function decodePdfLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "b") out += "\b";
    else if (n === "f") out += "\f";
    else if (n >= "0" && n <= "7") {
      let oct = n;
      for (let k = 0; k < 2; k++) {
        const d = raw[i + 1];
        if (d === undefined || d < "0" || d > "7") break;
        oct += d;
        i++;
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}
