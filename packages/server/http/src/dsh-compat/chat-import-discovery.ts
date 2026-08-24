/**
 * dsh-chat-import session discovery — generic host adapter (Node fs).
 * Mirrors lib/discovery.mjs defaultRoots + core scanners without Cordis deps.
 */
import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const CHAT_IMPORT_FORMATS = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "dsh",
] as const;

export type ChatImportFormat = (typeof CHAT_IMPORT_FORMATS)[number];

/** Client source id → discovery format (panel.mjs SOURCE_FORMAT). */
export const CHAT_IMPORT_SOURCE_FORMAT: Record<string, ChatImportFormat> = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor",
  gemini: "gemini",
  dsh: "dsh",
};

export interface DiscoveredSession {
  format: ChatImportFormat;
  sessionId: string;
  title: string | null;
  project: string | null;
  createdAt: number | null;
  lastActiveAt: number | null;
  messageCount: number | null;
  sourcePath: string;
  importStatus: string | null;
}

const TITLE_MAX = 80;
const HEAD_MAX_BYTES = 256 * 1024;
const SCAN_TTL_MS = 30_000;

const scanCache = new Map<string, { ts: number; data: DiscoveredSession[] }>();

export function defaultChatImportRoots(home = homedir()): Record<
  ChatImportFormat,
  string | string[] | null
> {
  const localAppData = process.env.LOCALAPPDATA ?? null;
  const claude3p = localAppData
    ? path.join(localAppData, "Claude-3p", "claude-code-sessions")
    : null;
  return {
    claude: claude3p
      ? [path.join(home, ".claude", "projects"), claude3p]
      : path.join(home, ".claude", "projects"),
    codex: path.join(home, ".codex", "sessions"),
    cursor: path.join(home, ".cursor", "projects"),
    gemini: path.join(home, ".gemini", "history"),
    dsh: path.join(home, ".dsh", "sessions"),
  };
}

function normalizeTitle(raw: string): string | null {
  const folded = raw.replace(/\s+/g, " ").trim();
  if (!folded) return null;
  if (folded.length <= TITLE_MAX) return folded;
  return `${folded.slice(0, TITLE_MAX - 1)}…`;
}

function readHead(filePath: string): string | null {
  try {
    const buf = readFileSync(filePath);
    return buf.subarray(0, HEAD_MAX_BYTES).toString("utf8");
  } catch {
    return null;
  }
}

function parseJsonlHead(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as unknown);
    } catch {
      break;
    }
  }
  return out;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const row = part as Record<string, unknown>;
        if (typeof row.text === "string") return row.text;
        return "";
      })
      .join("");
  }
  return "";
}

function firstUserTitle(
  recs: unknown[],
  pick: (row: Record<string, unknown>) => string,
): string | null {
  for (const rec of recs) {
    if (!rec || typeof rec !== "object") continue;
    const text = pick(rec as Record<string, unknown>).trim();
    if (!text) continue;
    if (text.startsWith("<environment_context>")) continue;
    if (text.startsWith("<system-reminder>")) continue;
    return normalizeTitle(text);
  }
  return null;
}

function layoutProject(filePath: string, format: ChatImportFormat): string | null {
  const parts = filePath.split(path.sep);
  if (format === "claude") {
    const idx = parts.findIndex((p) => p === "projects");
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]!);
  }
  if (format === "codex") {
    const idx = parts.findIndex((p) => p === "sessions");
    if (idx >= 0 && parts[idx + 3]) {
      return `${parts[idx + 1]}/${parts[idx + 2]}/${parts[idx + 3]}`;
    }
  }
  if (format === "cursor") {
    const idx = parts.findIndex((p) => p === "projects");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]!;
  }
  return null;
}

function walkFiles(
  root: string,
  accept: (name: string) => boolean,
  depth = 0,
): string[] {
  if (depth > 8 || !existsSync(root)) return [];
  const out: string[] = [];
  try {
    for (const name of readdirSync(root)) {
      const abs = path.join(root, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        out.push(...walkFiles(abs, accept, depth + 1));
      } else if (st.isFile() && accept(name)) {
        out.push(abs);
      }
    }
  } catch {
    return out;
  }
  return out;
}

function makeEntry(
  partial: Omit<DiscoveredSession, "importStatus">,
): DiscoveredSession {
  return { ...partial, importStatus: null };
}

function scanClaude(root: string): DiscoveredSession[] {
  const files = walkFiles(root, (n) => /\.jsonl$/i.test(n));
  const out: DiscoveredSession[] = [];
  for (const filePath of files) {
    const stem = path.basename(filePath, path.extname(filePath));
    if (stem.startsWith("agent-")) continue;
    const st = statSync(filePath);
    const head = readHead(filePath);
    if (!head) continue;
    const recs = parseJsonlHead(head);
    let sessionId = "";
    for (const rec of recs) {
      if (rec && typeof rec === "object" && typeof (rec as { sessionId?: unknown }).sessionId === "string") {
        sessionId = (rec as { sessionId: string }).sessionId;
        break;
      }
    }
    if (!sessionId || sessionId !== stem) continue;
    let cwd: string | undefined;
    for (const rec of recs) {
      if (rec && typeof rec === "object" && typeof (rec as { cwd?: unknown }).cwd === "string") {
        cwd = (rec as { cwd: string }).cwd;
        break;
      }
    }
    const title = firstUserTitle(recs, (r) =>
      r.type === "user" &&
      r.message &&
      typeof r.message === "object" &&
      (r.message as { role?: string }).role === "user"
        ? contentText((r.message as { content?: unknown }).content)
        : "",
    );
    out.push(
      makeEntry({
        format: "claude",
        sessionId,
        title,
        project: cwd ? path.basename(cwd) : layoutProject(filePath, "claude"),
        createdAt: st.mtimeMs,
        lastActiveAt: st.mtimeMs,
        messageCount: null,
        sourcePath: filePath,
      }),
    );
  }
  return out;
}

function scanCodex(root: string): DiscoveredSession[] {
  const files = walkFiles(root, (n) => /\.jsonl$/i.test(n));
  const out: DiscoveredSession[] = [];
  for (const filePath of files) {
    const st = statSync(filePath);
    const head = readHead(filePath);
    if (!head) continue;
    const recs = parseJsonlHead(head);
    const meta = recs.find(
      (r) =>
        r &&
        typeof r === "object" &&
        (r as { type?: string }).type === "session_meta" &&
        (r as { payload?: unknown }).payload &&
        typeof (r as { payload: unknown }).payload === "object",
    ) as { payload?: Record<string, unknown> } | undefined;
    if (!meta?.payload) continue;
    const payload = meta.payload;
    if (
      payload.thread_source === "subagent" ||
      (payload.source &&
        typeof payload.source === "object" &&
        (payload.source as { subagent?: unknown }).subagent)
    ) {
      continue;
    }
    const sessionId =
      typeof payload.id === "string" && payload.id
        ? payload.id
        : (filePath.match(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
          )?.[0] ?? randomUUID());
    const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
    const title = firstUserTitle(recs, (r) =>
      r.type === "response_item" &&
      r.payload &&
      typeof r.payload === "object" &&
      (r.payload as { type?: string }).type === "message" &&
      (r.payload as { role?: string }).role === "user"
        ? contentText((r.payload as { content?: unknown }).content)
        : "",
    );
    out.push(
      makeEntry({
        format: "codex",
        sessionId,
        title,
        project: cwd ? path.basename(cwd) : layoutProject(filePath, "codex"),
        createdAt: st.mtimeMs,
        lastActiveAt: st.mtimeMs,
        messageCount: null,
        sourcePath: filePath,
      }),
    );
  }
  return out;
}

function scanCursor(root: string): DiscoveredSession[] {
  const files = walkFiles(root, (n) => /\.jsonl$/i.test(n));
  const out: DiscoveredSession[] = [];
  for (const filePath of files) {
    if (!/agent-transcripts/i.test(filePath)) continue;
    const stem = path.basename(filePath, ".jsonl");
    if (stem !== path.basename(path.dirname(filePath))) continue;
    const st = statSync(filePath);
    const head = readHead(filePath);
    if (!head) continue;
    const recs = parseJsonlHead(head);
    const title = firstUserTitle(recs, (r) =>
      r.role === "user"
        ? contentText(
            (r.message as { content?: unknown } | undefined)?.content ??
              r.content,
          ).replace(/<\/?user_query>/g, "")
        : "",
    );
    out.push(
      makeEntry({
        format: "cursor",
        sessionId: stem,
        title,
        project: layoutProject(filePath, "cursor"),
        createdAt: null,
        lastActiveAt: st.mtimeMs,
        messageCount: null,
        sourcePath: filePath,
      }),
    );
  }
  return out;
}

function scanGemini(root: string): DiscoveredSession[] {
  const files = walkFiles(root, (n) => /^session-.+\.json$/i.test(n));
  const out: DiscoveredSession[] = [];
  for (const filePath of files) {
    const st = statSync(filePath);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      continue;
    }
    const sessionId =
      typeof parsed.sessionId === "string"
        ? parsed.sessionId
        : path.basename(filePath, ".json");
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const title = firstUserTitle(messages, (r) =>
      r.type === "user" ? contentText(r.content) : "",
    );
    out.push(
      makeEntry({
        format: "gemini",
        sessionId,
        title,
        project: null,
        createdAt:
          typeof parsed.startTime === "number" ? parsed.startTime : st.mtimeMs,
        lastActiveAt: st.mtimeMs,
        messageCount: messages.length,
        sourcePath: filePath,
      }),
    );
  }
  return out;
}

function scanDsh(root: string, xrkHome?: string): DiscoveredSession[] {
  const roots = [root];
  if (xrkHome) {
    roots.push(path.join(xrkHome, "sessions"));
  }
  const out: DiscoveredSession[] = [];
  for (const scanRoot of roots) {
    const files = walkFiles(scanRoot, (n) =>
      /\.(jsonl|json)$/i.test(n),
    );
    for (const filePath of files) {
      const st = statSync(filePath);
      const sessionId = path.basename(filePath).replace(/\.(jsonl|json)$/i, "");
      const head = readHead(filePath);
      const title =
        head && filePath.endsWith(".jsonl")
          ? firstUserTitle(parseJsonlHead(head), (r) =>
              typeof r.content === "string"
                ? r.content
                : contentText(r.content),
            )
          : null;
      out.push(
        makeEntry({
          format: "dsh",
          sessionId,
          title,
          project: path.basename(path.dirname(filePath)),
          createdAt: st.mtimeMs,
          lastActiveAt: st.mtimeMs,
          messageCount: null,
          sourcePath: filePath,
        }),
      );
    }
  }
  return out;
}

const SCANNERS: Record<
  ChatImportFormat,
  (root: string, xrkHome?: string) => DiscoveredSession[]
> = {
  claude: (root) => scanClaude(root),
  codex: (root) => scanCodex(root),
  cursor: (root) => scanCursor(root),
  gemini: (root) => scanGemini(root),
  dsh: (root, xrkHome) => scanDsh(root, xrkHome),
};

function rootsForFormat(
  format: ChatImportFormat,
  home = homedir(),
): string[] {
  const row = defaultChatImportRoots(home)[format];
  if (!row) return [];
  return Array.isArray(row) ? row : [row];
}

function applyImportStatus(
  sessions: DiscoveredSession[],
  imports: Record<string, { status?: string }>,
): DiscoveredSession[] {
  return sessions.map((s) => {
    const key = importFingerprint(s);
    const row = imports[key];
    return {
      ...s,
      importStatus: row?.status ?? null,
    };
  });
}

export function importFingerprint(session: {
  format: string;
  sessionId: string;
  sourcePath: string;
}): string {
  return createHash("sha256")
    .update(`${session.format}\0${session.sessionId}\0${session.sourcePath}`)
    .digest("hex");
}

export function discoverChatImportSessions(options: {
  readonly format?: ChatImportFormat;
  readonly path?: string;
  readonly query?: string;
  readonly xrkHome?: string;
  readonly imports?: Record<string, { status?: string }>;
  readonly home?: string;
}): { sessions: DiscoveredSession[]; total: number } {
  const home = options.home ?? homedir();
  const imports = options.imports ?? {};
  const query = (options.query ?? "").trim().toLowerCase();
  const formats: ChatImportFormat[] = options.format
    ? [options.format]
    : [...CHAT_IMPORT_FORMATS];

  let sessions: DiscoveredSession[] = [];
  for (const format of formats) {
    const targets = options.path
      ? [path.resolve(options.path)]
      : rootsForFormat(format, home);
    for (const target of targets) {
      const cacheKey = `${format}|${target}`;
      const hit = scanCache.get(cacheKey);
      let rows: DiscoveredSession[];
      if (hit && Date.now() - hit.ts < SCAN_TTL_MS) {
        rows = hit.data;
      } else {
        rows = SCANNERS[format](target, options.xrkHome);
        scanCache.set(cacheKey, { ts: Date.now(), data: rows });
      }
      sessions.push(...rows);
    }
  }

  if (query) {
    sessions = sessions.filter((s) => {
      const hay = [
        s.title ?? "",
        s.project ?? "",
        s.sourcePath,
        s.sessionId,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }

  sessions.sort(
    (a, b) =>
      (b.lastActiveAt ?? b.createdAt ?? 0) -
      (a.lastActiveAt ?? a.createdAt ?? 0),
  );
  sessions = applyImportStatus(sessions, imports);
  return { sessions, total: sessions.length };
}

/** Async wrapper for large trees (yields event loop between formats). */
export async function discoverChatImportSessionsAsync(
  options: Parameters<typeof discoverChatImportSessions>[0],
): Promise<{ sessions: DiscoveredSession[]; total: number }> {
  return discoverChatImportSessions(options);
}

export function clearChatImportScanCache(): void {
  scanCache.clear();
}
