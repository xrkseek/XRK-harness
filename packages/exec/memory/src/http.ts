/**
 * HTTP curated-memory provider — Hermes-style external MemoryProvider sample.
 *
 * Minimal REST (integrator-owned sidecar; not Mem0/Supermemory wire protocol):
 * - `GET  /health` → `{ ok: true }`
 * - `GET  /v1/curated/{memory|user}` → `{ entries: string[] }`
 * - `POST /v1/curated/{memory|user}/ops` → write-result JSON
 *   body: `{ operations: CuratedMemoryOperation[] }` (same shape as the `memory` tool)
 *
 * Snapshot is frozen at construction (same semantics as the file store).
 * Writes are async (`Promise`); consumers use `await Promise.resolve(store.add(…))`.
 */

import type {
  CuratedMemoryOperation,
  CuratedMemoryStore,
  CuratedMemoryTarget,
  CuratedMemoryWriteResult,
} from "./store.js";
import {
  ENTRY_DELIMITER,
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
} from "./store.js";
import type { MemoryProvider } from "./provider.js";

const HEADERS = {
  memory:
    "MEMORY (durable facts across sessions — not a todo list or unfinished-work queue)",
  user: "USER PROFILE (who the user is)",
} as const;

export interface HttpMemoryProviderOptions {
  /** Base URL of the curated-memory sidecar (no trailing slash required). */
  readonly baseUrl: string;
  /** Optional bearer token (`Authorization: Bearer …`). */
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  /**
   * Logical dir label for tooling/tests (HTTP has no local files).
   * Default derived from `baseUrl`.
   */
  readonly dir?: string;
  /** Request timeout in ms. Default 8_000. */
  readonly timeoutMs?: number;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function limitFor(target: CuratedMemoryTarget): number {
  return target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

function usagePct(current: number, limit: number): string {
  const pct = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
  return `${pct}% — ${current.toLocaleString("en-US")}/${limit.toLocaleString("en-US")} chars`;
}

function renderBlock(
  target: CuratedMemoryTarget,
  entries: readonly string[],
): string {
  if (entries.length === 0) return "";
  const content = entries.join(ENTRY_DELIMITER);
  const sep = "═".repeat(46);
  return `${sep}\n${HEADERS[target]} [${usagePct(content.length, limitFor(target))}]\n${sep}\n${content}`;
}

function asEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => String(row ?? "").trim())
    .filter((row) => row.length > 0);
}

export class HttpMemoryProviderError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = "MEMORY_HTTP", status?: number) {
    super(message);
    this.name = "HttpMemoryProviderError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/**
 * Build a {@link MemoryProvider} over an HTTP curated-memory sidecar.
 * Throws when the initial snapshot fetch fails (fail closed at composition).
 */
export async function createHttpMemoryProvider(
  options: HttpMemoryProviderOptions,
): Promise<MemoryProvider> {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new HttpMemoryProviderError(
      "http memory provider needs a non-empty baseUrl",
      "MEMORY_HTTP_CONFIG",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const authHeaders: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (options.token?.trim()) {
    authHeaders.Authorization = `Bearer ${options.token.trim()}`;
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(joinUrl(baseUrl, path), {
        method,
        headers: authHeaders,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: ac.signal,
      });
      const text = await res.text().catch(() => "");
      let json: unknown = undefined;
      if (text.trim()) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        throw new HttpMemoryProviderError(
          `curated-memory HTTP ${res.status}: ${text.slice(0, 200)}`,
          "MEMORY_HTTP_BACKEND",
          res.status,
        );
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadEntries(
    target: CuratedMemoryTarget,
  ): Promise<readonly string[]> {
    const json = (await request("GET", `/v1/curated/${target}`)) as {
      entries?: unknown;
    };
    return asEntries(json?.entries);
  }

  const [memoryFrozen, userFrozen] = await Promise.all([
    loadEntries("memory"),
    loadEntries("user"),
  ]);

  const liveCache: Record<CuratedMemoryTarget, string[]> = {
    memory: [...memoryFrozen],
    user: [...userFrozen],
  };

  const dir = options.dir?.trim() || `${baseUrl}/curated`;

  async function runOps(
    target: CuratedMemoryTarget,
    operations: readonly CuratedMemoryOperation[],
  ): Promise<CuratedMemoryWriteResult> {
    try {
      const json = (await request("POST", `/v1/curated/${target}/ops`, {
        operations,
      })) as CuratedMemoryWriteResult & {
        entries?: unknown;
        current_entries?: unknown;
      };
      if (Array.isArray(json.current_entries)) {
        liveCache[target] = asEntries(json.current_entries);
      } else if (Array.isArray(json.entries)) {
        liveCache[target] = asEntries(json.entries);
      }
      const success = json.success !== false && !json.error;
      return {
        success,
        ...(json.done !== undefined ? { done: json.done } : {}),
        ...(json.error !== undefined ? { error: json.error } : {}),
        ...(json.message !== undefined ? { message: json.message } : {}),
        target: json.target ?? target,
        ...(json.usage !== undefined ? { usage: json.usage } : {}),
        entry_count: json.entry_count ?? liveCache[target].length,
        current_entries: Array.isArray(json.current_entries)
          ? asEntries(json.current_entries)
          : liveCache[target],
        ...(json.note !== undefined ? { note: json.note } : {}),
        ...(json.drift_backup !== undefined
          ? { drift_backup: json.drift_backup }
          : {}),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        target,
      };
    }
  }

  const store: CuratedMemoryStore = {
    dir,
    frozenPrompt(target) {
      return renderBlock(
        target,
        target === "user" ? userFrozen : memoryFrozen,
      );
    },
    frozenSystemBlock() {
      return [store.frozenPrompt("memory"), store.frozenPrompt("user")]
        .filter((block) => block.length > 0)
        .join("\n\n");
    },
    async listEntries(target) {
      try {
        const entries = await loadEntries(target);
        liveCache[target] = [...entries];
        return liveCache[target];
      } catch {
        return liveCache[target];
      }
    },
    add(target, content) {
      return runOps(target, [{ action: "add", content }]);
    },
    replace(target, oldText, content) {
      return runOps(target, [
        { action: "replace", old_text: oldText, content },
      ]);
    },
    remove(target, oldText) {
      return runOps(target, [{ action: "remove", old_text: oldText }]);
    },
    applyBatch(target, operations) {
      return runOps(target, operations);
    },
  };

  return {
    ...store,
    providerName: "http",
    async isAvailable() {
      try {
        const json = (await request("GET", "/health")) as { ok?: unknown };
        return json?.ok === true || json?.ok === "true";
      } catch {
        return false;
      }
    },
  };
}

/**
 * Probe `/health` without constructing a full store.
 */
export async function probeHttpMemoryProvider(
  options: Pick<
    HttpMemoryProviderOptions,
    "baseUrl" | "token" | "fetchImpl" | "timeoutMs"
  >,
): Promise<boolean> {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) return false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token?.trim()) {
    headers.Authorization = `Bearer ${options.token.trim()}`;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(joinUrl(baseUrl, "/health"), {
      method: "GET",
      headers,
      signal: ac.signal,
    });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => ({}))) as { ok?: unknown };
    return json.ok === true || json.ok === "true";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
