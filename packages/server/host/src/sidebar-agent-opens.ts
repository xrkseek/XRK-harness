/**
 * Model `sidebar_open` delivery registry — Host→browser push over
 * `/sidebar/ws/agent-opens` (consume-on-send; queue when no view).
 */
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export type AgentOpenKind = "file" | "folder" | "url";

/** Wire face for one open request (one JSON object per WS frame). */
export interface AgentOpenRequest {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: AgentOpenKind;
  readonly target: string;
  readonly title: string;
}

type Sender = (request: AgentOpenRequest) => void;

export class AgentOpenRegistry {
  private pending = new Map<string, AgentOpenRequest[]>();
  private subscribers = new Map<string, Set<Sender>>();

  enqueue(
    sessionId: string,
    kind: AgentOpenKind,
    target: string,
    title: string,
  ): { id: string; delivered: boolean } {
    const request: AgentOpenRequest = {
      id: randomUUID(),
      sessionId,
      kind,
      target,
      title,
    };
    const list = this.pending.get(sessionId) ?? [];
    list.push(request);
    this.pending.set(sessionId, list);
    const views = this.subscribers.get(sessionId);
    if (views !== undefined && views.size > 0) {
      for (const send of views) send(request);
      this.pending.delete(sessionId);
      return { id: request.id, delivered: true };
    }
    return { id: request.id, delivered: false };
  }

  attach(sessionId: string, send: Sender): () => void {
    let views = this.subscribers.get(sessionId);
    if (views === undefined) {
      views = new Set();
      this.subscribers.set(sessionId, views);
    }
    views.add(send);
    const queued = this.pending.get(sessionId) ?? [];
    if (queued.length > 0) {
      for (const request of queued) send(request);
      this.pending.delete(sessionId);
    }
    return () => {
      const current = this.subscribers.get(sessionId);
      current?.delete(send);
      if (current !== undefined && current.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  drainAll(): void {
    this.pending.clear();
  }

  dispose(): void {
    this.pending.clear();
    this.subscribers.clear();
  }
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

function isWindowsDrivePrefix(raw: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(raw);
}

/** Classify a raw target: http(s) URL or a local path (stat-driven). */
export async function classifyAgentOpenTarget(
  raw: string,
  cwd: string,
): Promise<{ kind: AgentOpenKind; target: string; title: string }> {
  if (/^https?:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`"${raw}" is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("sidebar_open only accepts http:// and https:// URLs");
    }
    const title = parsed.hostname !== "" ? parsed.hostname : raw;
    return { kind: "url", target: raw, title };
  }
  if (!isWindowsDrivePrefix(raw) && /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    throw new Error(
      "sidebar_open only accepts http:// and https:// URLs; use a local path for files",
    );
  }
  const target = resolve(isAbsolute(raw) ? raw : join(cwd, raw));
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`"${raw}" does not exist (resolved to "${target}")`, {
        cause: error,
      });
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new Error(`"${target}" is not readable`, { cause: error });
    }
    throw new Error(
      `cannot open "${target}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const title = basenameOf(target);
  return {
    kind: info.isDirectory() ? "folder" : "file",
    target,
    title: title === "" ? raw : title,
  };
}
