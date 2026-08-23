/**
 * XRK-native bridges for DSH Host features that cannot embed Cordis fiber.
 * Local / heuristic / optional remote — not upstream Cordis parity.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface ModsearchHit {
  readonly title: string;
  readonly path: string;
  readonly snippet: string;
  readonly source: "local" | "tavily" | "exa";
}

export interface ModsearchQueryOptions {
  readonly workspaceRoot?: string;
  readonly engine?: string;
  readonly engines?: Record<string, { apiKey?: string; baseURL?: string; enabled?: boolean }>;
  readonly limit?: number;
}

export async function runModsearchQuery(
  query: string,
  options: ModsearchQueryOptions = {},
): Promise<Record<string, unknown>> {
  const q = query.trim();
  if (!q) {
    return { ok: false, code: "empty-query", results: [] };
  }
  const limit = options.limit ?? 20;
  const engine = options.engine?.trim() || "local";
  const row = options.engines?.[engine];
  if (engine === "tavily" && row?.apiKey) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: row.apiKey,
          query: q,
          max_results: Math.min(limit, 10),
        }),
      });
      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const results: ModsearchHit[] = (data.results ?? []).map((hit) => ({
        title: hit.title ?? hit.url ?? "result",
        path: hit.url ?? "",
        snippet: hit.content ?? "",
        source: "tavily",
      }));
      return { ok: true, engine, results, adapter: DSH_COMPAT_ADAPTER };
    } catch (err) {
      return {
        ok: false,
        engine,
        code: "tavily-failed",
        message: err instanceof Error ? err.message : String(err),
        results: [],
      };
    }
  }
  if (engine === "exa" && row?.apiKey) {
    try {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": row.apiKey,
        },
        body: JSON.stringify({
          query: q,
          numResults: Math.min(limit, 10),
        }),
      });
      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; text?: string }>;
      };
      const results: ModsearchHit[] = (data.results ?? []).map((hit) => ({
        title: hit.title ?? hit.url ?? "result",
        path: hit.url ?? "",
        snippet: hit.text ?? "",
        source: "exa",
      }));
      return { ok: true, engine, results, adapter: DSH_COMPAT_ADAPTER };
    } catch (err) {
      return {
        ok: false,
        engine,
        code: "exa-failed",
        message: err instanceof Error ? err.message : String(err),
        results: [],
      };
    }
  }
  const local = localWorkspaceSearch(options.workspaceRoot, q, limit);
  return {
    ok: true,
    engine: "local",
    results: local,
    adapter: DSH_COMPAT_ADAPTER,
    note: local.length
      ? "Workspace text search via XRK bridge."
      : "No local hits — configure tavily/exa apiKey for remote search.",
  };
}

function localWorkspaceSearch(
  workspaceRoot: string | undefined,
  query: string,
  limit: number,
): ModsearchHit[] {
  const root = workspaceRoot?.trim();
  if (!root || !existsSync(root)) return [];
  try {
    const out = execFileSync(
      "rg",
      ["-l", "--max-count", "1", "-F", query, root],
      { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, limit)
      .map((abs) => ({
        title: path.basename(abs),
        path: abs,
        snippet: query,
        source: "local" as const,
      }));
  } catch {
    return walkWorkspaceFallback(root, query, limit);
  }
}

function walkWorkspaceFallback(
  root: string,
  query: string,
  limit: number,
): ModsearchHit[] {
  const lower = query.toLowerCase();
  const hits: ModsearchHit[] = [];
  const skip = new Set(["node_modules", ".git", "dist", ".xrk"]);
  const walk = (dir: string, depth: number) => {
    if (hits.length >= limit || depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (hits.length >= limit) break;
      if (skip.has(name)) continue;
      const abs = path.join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      if (!/\.(md|txt|ts|tsx|js|mjs|json|yaml|yml)$/i.test(name)) continue;
      if (st.size > 512_000) continue;
      try {
        const text = readFileSync(abs, "utf8");
        if (text.toLowerCase().includes(lower)) {
          hits.push({
            title: name,
            path: abs,
            snippet: query,
            source: "local",
          });
        }
      } catch {
        /* ignore */
      }
    }
  };
  walk(root, 0);
  return hits;
}

export const GENUI_COMPONENT_REGISTRY = [
  "Card",
  "Text",
  "Button",
  "Row",
  "Column",
  "Stack",
  "Image",
  "Input",
  "Box",
  "Fragment",
] as const;

function buildGenuiReactTree(node: unknown): Record<string, unknown> {
  if (node === null || node === undefined) {
    return { type: "Text", props: { value: "" } };
  }
  if (typeof node !== "object") {
    return { type: "Text", props: { value: String(node) } };
  }
  if (Array.isArray(node)) {
    return { type: "Fragment", children: node.map((item) => buildGenuiReactTree(item)) };
  }
  const row = node as Record<string, unknown>;
  const rawType = String(row.type ?? "Box");
  const normalized =
    rawType.length > 0
      ? rawType.charAt(0).toUpperCase() + rawType.slice(1)
      : "Box";
  const children = Array.isArray(row.children)
    ? row.children.map((item) => buildGenuiReactTree(item))
    : row.body
      ? [buildGenuiReactTree(row.body)]
      : undefined;
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "type" || key === "children" || key === "body") continue;
    props[key] = value;
  }
  return {
    type: normalized,
    ...(Object.keys(props).length > 0 ? { props } : {}),
    ...(children && children.length > 0 ? { children } : {}),
  };
}

export function renderGenuiFromSchema(
  schema: Record<string, unknown>,
): {
  preview: string;
  tree: Record<string, unknown>;
  html: string;
  reactTree: Record<string, unknown>;
  componentRegistry: readonly string[];
  live: boolean;
} {
  const lines: string[] = [];
  const walk = (node: unknown, depth: number, label: string) => {
    const pad = "  ".repeat(depth);
    if (node === null || node === undefined) {
      lines.push(`${pad}${label}: null`);
      return;
    }
    if (typeof node !== "object") {
      lines.push(`${pad}${label}: ${String(node)}`);
      return;
    }
    if (Array.isArray(node)) {
      lines.push(`${pad}${label}: [${node.length}]`);
      node.slice(0, 8).forEach((item, i) => walk(item, depth + 1, `[${i}]`));
      return;
    }
    const row = node as Record<string, unknown>;
    const type =
      typeof row.type === "string" ? row.type : Array.isArray(row) ? "array" : "object";
    lines.push(`${pad}${label}: <${type}>`);
    for (const [key, value] of Object.entries(row).slice(0, 24)) {
      walk(value, depth + 1, key);
    }
  };
  walk(schema, 0, "root");
  const html = renderGenuiHtmlFromSchema(schema);
  const reactTree = buildGenuiReactTree(schema);
  return {
    preview: lines.join("\n"),
    tree: schema,
    html,
    reactTree,
    componentRegistry: GENUI_COMPONENT_REGISTRY,
    live: true,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGenuiHtmlFromSchema(schema: Record<string, unknown>): string {
  const renderNode = (node: unknown): string => {
    if (node === null || node === undefined) return "";
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      return `<span>${escapeHtml(String(node))}</span>`;
    }
    if (Array.isArray(node)) {
      return node.map((item) => renderNode(item)).join("");
    }
    if (typeof node !== "object") return "";
    const row = node as Record<string, unknown>;
    const type = String(row.type ?? "box").toLowerCase();
    const children = Array.isArray(row.children)
      ? row.children.map((c) => renderNode(c)).join("")
      : row.body
        ? renderNode(row.body)
        : row.value != null
          ? escapeHtml(String(row.value))
          : "";
    const title =
      typeof row.title === "string"
        ? `<header>${escapeHtml(row.title)}</header>`
        : typeof row.label === "string"
          ? `<header>${escapeHtml(row.label)}</header>`
          : "";
    switch (type) {
      case "text":
      case "paragraph":
        return `<p data-genui="${type}">${children || escapeHtml(String(row.value ?? ""))}</p>`;
      case "button":
        return `<button type="button" data-genui="button">${children || escapeHtml(String(row.label ?? "Action"))}</button>`;
      case "card":
      case "panel":
        return `<section data-genui="${type}">${title}${children}</section>`;
      case "row":
      case "column":
      case "stack":
        return `<div data-genui="${type}" style="display:flex;flex-direction:${type === "column" ? "column" : "row"};gap:8px">${children}</div>`;
      default:
        return `<div data-genui="${escapeHtml(type)}">${title}${children}</div>`;
    }
  };
  return `<div data-xrk-genui-preview="1">${renderNode(schema)}</div>`;
}

export interface ImageAnalysis {
  readonly format: "png" | "jpeg" | "gif" | "webp" | "unknown";
  readonly width?: number;
  readonly height?: number;
  readonly bytes: number;
  readonly sha256Prefix: string;
}

function readBeUInt32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

export function analyzeImageBuffer(buf: Buffer): ImageAnalysis {
  const bytes = buf.length;
  const sha256Prefix = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  if (bytes >= 24 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") {
    return {
      format: "png",
      width: readBeUInt32(buf, 16),
      height: readBeUInt32(buf, 20),
      bytes,
      sha256Prefix,
    };
  }
  if (bytes >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const len = buf.readUInt16BE(offset + 2);
      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3
      ) {
        return {
          format: "jpeg",
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
          bytes,
          sha256Prefix,
        };
      }
      offset += 2 + len;
    }
    return { format: "jpeg", bytes, sha256Prefix };
  }
  if (
    bytes >= 6 &&
    (buf.toString("ascii", 0, 6) === "GIF87a" ||
      buf.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return {
      format: "gif",
      width: buf.readUInt16LE(6),
      height: buf.readUInt16LE(8),
      bytes,
      sha256Prefix,
    };
  }
  if (
    bytes >= 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { format: "webp", bytes, sha256Prefix };
  }
  return { format: "unknown", bytes, sha256Prefix };
}

export function decodePasteImageBuffers(
  raw: Buffer | string,
): Buffer[] {
  if (Buffer.isBuffer(raw) && raw.length > 0) {
    if (raw[0] === 0x7b || raw[0] === 0x5b) {
      try {
        const parsed = JSON.parse(raw.toString("utf8")) as unknown;
        return extractImageBuffersFromJson(parsed);
      } catch {
        return [raw];
      }
    }
    return [raw];
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return extractImageBuffersFromJson(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

function extractImageBuffersFromJson(parsed: unknown): Buffer[] {
  const out: Buffer[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      const m = /^data:image\/[^;]+;base64,(.+)$/i.exec(node.trim());
      if (m?.[1]) {
        try {
          out.push(Buffer.from(m[1], "base64"));
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      const row = node as Record<string, unknown>;
      if (typeof row.data === "string") visit(row.data);
      if (typeof row.base64 === "string") visit(row.base64);
      if (typeof row.content === "string") visit(row.content);
      if (Array.isArray(row.images)) visit(row.images);
    }
  };
  visit(parsed);
  return out;
}

export function extractAsciiFromImageBuffer(buf: Buffer): string {
  const chunks: string[] = [];
  let current = "";
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
    } else if (current.length >= 4) {
      chunks.push(current);
      current = "";
    } else {
      current = "";
    }
  }
  if (current.length >= 4) chunks.push(current);
  return chunks.join("\n").slice(0, 8000);
}

export function analyzeVisionImage(buf: Buffer): ImageAnalysis & {
  ocrText: string;
  analyzed: true;
} {
  const meta = analyzeImageBuffer(buf);
  return {
    ...meta,
    ocrText: extractAsciiFromImageBuffer(buf),
    analyzed: true,
  };
}

export function analyzePastePayload(raw: Buffer | string): {
  images: Array<ImageAnalysis & { index: number; ocrText: string; analyzed: boolean }>;
  analyzed: boolean;
} {
  const buffers = decodePasteImageBuffers(raw);
  const images = buffers.map((buf, index) => ({
    index,
    ...analyzeVisionImage(buf),
    analyzed: true,
  }));
  return { images, analyzed: images.length > 0 };
}

export interface TongflowScanOptions {
  readonly pluginsDir?: string;
  readonly workspaceRoot?: string;
}

export function scanTongflowRegistryFromInventory(
  packages: readonly { name: string; version?: string }[],
): Record<string, unknown> {
  const plugins: Record<string, unknown> = {};
  const nodePluginMap: Record<string, string> = {};
  const official: string[] = [];
  for (const pkg of packages) {
    const slug = pkg.name.replace(/^@/, "").replace(/\//g, "-");
    plugins[slug] = {
      id: slug,
      package: pkg.name,
      version: pkg.version ?? "0.0.0",
      source: "xrk-inventory",
    };
    nodePluginMap[`node.${slug}`] = slug;
    if (pkg.name.startsWith("dsh-") || pkg.name.includes("tongflow")) {
      official.push(slug);
    }
  }
  return {
    plugins,
    nodePluginMap,
    official,
    scanner: "typescript-inventory",
    python: false,
  };
}

export function tryPythonTongflowScan(
  workspaceRoot?: string,
): Record<string, unknown> | null {
  const script = [
    "import json,sys",
    "print(json.dumps({'plugins':{},'nodePluginMap':{},'official':[],'scanner':'python-stub','python':True}))",
  ].join("\n");
  for (const bin of ["python3", "python"]) {
    const res = spawnSync(bin, ["-c", script], {
      encoding: "utf8",
      timeout: 5000,
      cwd: workspaceRoot,
    });
    if (res.status !== 0 || !res.stdout?.trim()) continue;
    try {
      return JSON.parse(res.stdout) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

export function searchNoemaMemories(
  memories: readonly { id: string; text: string; tags: readonly string[] }[],
  query: string,
  limit = 16,
): Array<{ id: string; text: string; score: number }> {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return [];
  const scored = memories
    .map((row) => {
      const hay = `${row.text} ${row.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (hay.includes(token)) score += 1;
      }
      return { id: row.id, text: row.text, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

export function classifyAutoReviewHeuristic(
  payload: Record<string, unknown>,
): { verdict: "allow" | "deny" | "ask"; reason: string; confidence: number } {
  const toolName = String(payload.toolName ?? payload.name ?? "").toLowerCase();
  const args = JSON.stringify(payload.args ?? payload.arguments ?? payload.input ?? "");
  const blob = `${toolName} ${args}`.toLowerCase();
  const destructive =
    /\b(rm\s+-rf|del\s+\/|format\s+c:|drop\s+table|truncate\s+table|shutdown|mkfs)\b/;
  if (destructive.test(blob)) {
    return { verdict: "deny", reason: "destructive-pattern", confidence: 0.92 };
  }
  if (/\b(curl|wget|invoke-webrequest).*(http|https)/.test(blob)) {
    return { verdict: "ask", reason: "network-fetch", confidence: 0.7 };
  }
  if (/\b(shell|bash|powershell|exec|write|delete|unlink)\b/.test(toolName)) {
    return { verdict: "ask", reason: "sensitive-tool", confidence: 0.65 };
  }
  return { verdict: "allow", reason: "heuristic-pass", confidence: 0.55 };
}

export function validateImConnector(
  connector: Record<string, unknown> | undefined,
): { ok: boolean; missing: string[] } {
  if (!connector || typeof connector !== "object") {
    return { ok: false, missing: ["connector"] };
  }
  const required = ["appId", "appSecret", "token", "webhook", "corpId", "agentId"];
  const missing = required.filter((key) => {
    const v = connector[key];
    return typeof v !== "string" || !v.trim();
  });
  const hasAny = Object.values(connector).some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
  if (!hasAny) return { ok: false, missing: ["any-field"] };
  return { ok: missing.length < required.length, missing };
}
