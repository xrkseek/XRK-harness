/**
 * A2A v1.0 wire helpers + conversation persistence + anti-loop turn tracker.
 * Learned from Hermes `plugins/platforms/a2a/protocol.py` (stdlib-shaped).
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveXrkHome } from "@xrkseek/xrk-home-paths";

export const A2A_PROTOCOL_VERSION = "1.0";

export const ROLE_USER = "ROLE_USER";
export const ROLE_AGENT = "ROLE_AGENT";

export const STATE_COMPLETED = "TASK_STATE_COMPLETED";
export const STATE_INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED";
export const STATE_REJECTED = "TASK_STATE_REJECTED";

const DEFAULT_MAX_PINGPONG = 5;
const HARD_MAX_PINGPONG = 20;
const TURN_TTL_MS = 60 * 60 * 1000;

export function newContextId(): string {
  return `ctx_${randomUUID().replace(/-/g, "")}`;
}

export function newTaskId(): string {
  return `task_${randomUUID().replace(/-/g, "")}`;
}

function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Anti-loop turn cap per context (`XRK_A2A_MAX_PINGPONG_TURNS`, hard max 20). */
export function maxPingpongTurns(env: NodeJS.ProcessEnv = process.env): number {
  const v = envInt("XRK_A2A_MAX_PINGPONG_TURNS", DEFAULT_MAX_PINGPONG, env);
  return Math.max(1, Math.min(v, HARD_MAX_PINGPONG));
}

export function textMessage(
  role: string,
  text: string,
  contextId = "",
): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    role,
    parts: [{ text }],
    messageId: `msg_${randomUUID().replace(/-/g, "")}`,
  };
  if (contextId) msg.contextId = contextId;
  return msg;
}

export function extractText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);
  const rec = node as Record<string, unknown>;
  if (typeof rec.text === "string") return rec.text;
  if (Array.isArray(rec.parts)) {
    return rec.parts
      .map((p) => extractText(p))
      .filter(Boolean)
      .join("\n");
  }
  if (rec.message) return extractText(rec.message);
  if (Array.isArray(rec.artifacts)) {
    for (const a of rec.artifacts) {
      const t = extractText(a);
      if (t) return t;
    }
  }
  if (rec.status && typeof rec.status === "object") {
    return extractText((rec.status as Record<string, unknown>).message);
  }
  return "";
}

export function unwrapSendMessageResponse(result: unknown): unknown {
  if (result !== null && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    if (rec.task && typeof rec.task === "object") return rec.task;
    if (rec.message && typeof rec.message === "object") return rec.message;
  }
  return result;
}

export interface PersistedA2aMessage {
  readonly ts: number;
  readonly role: string;
  readonly text: string;
  readonly task_id: string;
}

/** Counts turns per context_id; beyond {@link maxPingpongTurns} callers should reject. */
export class TurnTracker {
  private readonly turns = new Map<string, { count: number; lastSeen: number }>();

  track(contextId: string, now = Date.now()): number {
    for (const [cid, v] of this.turns) {
      if (now - v.lastSeen > TURN_TTL_MS) this.turns.delete(cid);
    }
    const prev = this.turns.get(contextId);
    const count = (prev?.count ?? 0) + 1;
    this.turns.set(contextId, { count, lastSeen: now });
    return count;
  }

  reset(contextId: string): void {
    this.turns.delete(contextId);
  }

  peek(contextId: string): number {
    return this.turns.get(contextId)?.count ?? 0;
  }
}

export function a2aConversationsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.XRK_A2A_CONVERSATIONS_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(resolveXrkHome(env), "a2a_conversations");
}

function convPath(contextId: string, root: string): string {
  const safe =
    [...(contextId || "default")]
      .filter((c) => /[a-zA-Z0-9_-]/.test(c))
      .join("") || "default";
  return path.join(root, `${safe}.jsonl`);
}

/** Append one message to the context's on-disk log. Never throws. */
export function persistMessage(
  contextId: string,
  role: string,
  text: string,
  taskId = "",
  options: { readonly root?: string; readonly now?: number } = {},
): void {
  try {
    const root = options.root ?? a2aConversationsDir();
    mkdirSync(root, { recursive: true });
    const row: PersistedA2aMessage = {
      ts: options.now ?? Date.now() / 1000,
      role,
      text,
      task_id: taskId,
    };
    appendFileSync(convPath(contextId, root), `${JSON.stringify(row)}\n`, "utf8");
  } catch {
    // Persistence must not break the live call path.
  }
}

/** Last `limit` messages for a context (empty if missing / unreadable). */
export function loadConversation(
  contextId: string,
  limit = 50,
  options: { readonly root?: string } = {},
): PersistedA2aMessage[] {
  try {
    const root = options.root ?? a2aConversationsDir();
    const raw = readFileSync(convPath(contextId, root), "utf8");
    const out: PersistedA2aMessage[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as PersistedA2aMessage;
        if (entry && typeof entry.text === "string") out.push(entry);
      } catch {
        /* skip corrupt line */
      }
    }
    return out.slice(-Math.max(1, limit));
  } catch {
    return [];
  }
}

/** Context ids that have persisted conversations. */
export function listPersistedContexts(
  options: { readonly root?: string } = {},
): string[] {
  try {
    const root = options.root ?? a2aConversationsDir();
    return readdirSync(root)
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.slice(0, -".jsonl".length))
      .sort();
  } catch {
    return [];
  }
}
