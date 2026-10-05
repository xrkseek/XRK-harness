/**
 * Workspace-scoped conversation 主线 catalog. Sessions attach to one thread
 * and keep a short 支线 (current work). Survives session create/delete.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

export const THREAD_TITLE_MAX = 80;
export const THREAD_BRIEF_MAX = 4_000;
export const SIDELINE_MAX = 200;

export interface WorkspaceThread {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly updatedAt: number;
}

export interface SessionThreadBind {
  readonly threadId: string;
  readonly sideline?: string;
}

interface PersistShape {
  readonly version: 1;
  readonly threads: WorkspaceThread[];
  readonly sessions: Record<string, SessionThreadBind>;
}

const ID_RE = /^th_[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function threadsRoot(productHome?: string): string {
  return path.join(path.resolve(productHome ?? resolveXrkHome()), "session-threads");
}

function sanitizeWorkspaceId(workspaceId: string): string {
  const trimmed = workspaceId.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`invalid workspaceId: ${workspaceId}`);
  }
  return trimmed;
}

function filePath(workspaceId: string, productHome?: string): string {
  return path.join(threadsRoot(productHome), `${sanitizeWorkspaceId(workspaceId)}.json`);
}

function mintId(): string {
  return `th_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function parseBind(raw: unknown): SessionThreadBind | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.threadId !== "string" || !ID_RE.test(o.threadId)) return undefined;
  const sideline =
    typeof o.sideline === "string" ? clip(o.sideline, SIDELINE_MAX) : "";
  return sideline
    ? { threadId: o.threadId, sideline }
    : { threadId: o.threadId };
}

function parseThread(raw: unknown): WorkspaceThread | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) return undefined;
  if (typeof o.title !== "string") return undefined;
  const title = clip(o.title, THREAD_TITLE_MAX);
  if (!title) return undefined;
  const brief = typeof o.brief === "string" ? clip(o.brief, THREAD_BRIEF_MAX) : "";
  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : 0;
  return { id: o.id, title, brief, updatedAt };
}

function emptyDoc(): PersistShape {
  return { version: 1, threads: [], sessions: {} };
}

export class FaceSessionThreadStore {
  private readonly productHome: string | undefined;
  private readonly cache = new Map<string, PersistShape>();

  constructor(productHome?: string) {
    this.productHome = productHome;
  }

  private load(workspaceId: string): PersistShape {
    const cached = this.cache.get(workspaceId);
    if (cached) return cached;
    const file = filePath(workspaceId, this.productHome);
    if (!existsSync(file)) {
      const doc = emptyDoc();
      this.cache.set(workspaceId, doc);
      return doc;
    }
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      const o = parsed && typeof parsed === "object" ? (parsed as PersistShape) : emptyDoc();
      const threads = Array.isArray(o.threads)
        ? o.threads.flatMap((row) => {
            const thread = parseThread(row);
            return thread ? [thread] : [];
          })
        : [];
      const sessions: Record<string, SessionThreadBind> = {};
      if (o.sessions && typeof o.sessions === "object") {
        for (const [sessionId, bind] of Object.entries(o.sessions)) {
          const next = parseBind(bind);
          if (next) sessions[sessionId] = next;
        }
      }
      const doc: PersistShape = { version: 1, threads, sessions };
      this.cache.set(workspaceId, doc);
      return doc;
    } catch {
      const doc = emptyDoc();
      this.cache.set(workspaceId, doc);
      return doc;
    }
  }

  private save(workspaceId: string, doc: PersistShape): void {
    this.cache.set(workspaceId, doc);
    const dir = threadsRoot(this.productHome);
    mkdirSync(dir, { recursive: true });
    tryWriteJsonSidecar(filePath(workspaceId, this.productHome), doc);
  }

  list(workspaceId: string): readonly WorkspaceThread[] {
    return this.load(workspaceId).threads;
  }

  get(workspaceId: string, threadId: string): WorkspaceThread | undefined {
    return this.load(workspaceId).threads.find((row) => row.id === threadId);
  }

  bindOf(workspaceId: string, sessionId: string): SessionThreadBind | undefined {
    return this.load(workspaceId).sessions[sessionId];
  }

  /** Every session currently attached to a 主线 in this workspace. */
  listBinds(
    workspaceId: string,
  ): ReadonlyArray<{ readonly sessionId: string } & SessionThreadBind> {
    return Object.entries(this.load(workspaceId).sessions).map(([sessionId, bind]) => ({
      sessionId,
      ...bind,
    }));
  }

  upsert(
    workspaceId: string,
    input: { readonly id?: string; readonly title: string; readonly brief?: string },
  ): WorkspaceThread | undefined {
    const title = clip(input.title, THREAD_TITLE_MAX);
    if (!title) return undefined;
    const brief = clip(input.brief ?? "", THREAD_BRIEF_MAX);
    const doc = this.load(workspaceId);
    const id = input.id?.trim();
    const now = Date.now();
    if (id) {
      if (!ID_RE.test(id)) return undefined;
      const index = doc.threads.findIndex((row) => row.id === id);
      const next: WorkspaceThread = {
        id,
        title,
        brief,
        updatedAt: now,
      };
      const threads =
        index === -1
          ? [...doc.threads, next]
          : doc.threads.map((row, i) => (i === index ? next : row));
      this.save(workspaceId, { ...doc, threads });
      return next;
    }
    const minted: WorkspaceThread = {
      id: mintId(),
      title,
      brief,
      updatedAt: now,
    };
    this.save(workspaceId, { ...doc, threads: [...doc.threads, minted] });
    return minted;
  }

  switchTo(
    workspaceId: string,
    sessionId: string,
    threadId: string,
  ): SessionThreadBind | undefined {
    const doc = this.load(workspaceId);
    if (!doc.threads.some((row) => row.id === threadId)) return undefined;
    const prev = doc.sessions[sessionId];
    const next: SessionThreadBind = {
      threadId,
      ...(prev?.sideline ? { sideline: prev.sideline } : {}),
    };
    this.save(workspaceId, {
      ...doc,
      sessions: { ...doc.sessions, [sessionId]: next },
    });
    return next;
  }

  /** Drop a 主线 and every session bind pointing at it. */
  remove(workspaceId: string, threadId: string): boolean {
    const doc = this.load(workspaceId);
    if (!doc.threads.some((row) => row.id === threadId)) return false;
    const threads = doc.threads.filter((row) => row.id !== threadId);
    const sessions: Record<string, SessionThreadBind> = {};
    for (const [sessionId, bind] of Object.entries(doc.sessions)) {
      if (bind.threadId !== threadId) sessions[sessionId] = bind;
    }
    this.save(workspaceId, { ...doc, threads, sessions });
    return true;
  }

  setSideline(
    workspaceId: string,
    sessionId: string,
    sideline: string,
  ): SessionThreadBind | undefined {
    const doc = this.load(workspaceId);
    const prev = doc.sessions[sessionId];
    if (!prev) return undefined;
    const clipped = clip(sideline, SIDELINE_MAX);
    const next: SessionThreadBind = clipped
      ? { threadId: prev.threadId, sideline: clipped }
      : { threadId: prev.threadId };
    this.save(workspaceId, {
      ...doc,
      sessions: { ...doc.sessions, [sessionId]: next },
    });
    return next;
  }
}
