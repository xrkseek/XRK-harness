/**
 * dsh-noema — file-backed status, memory index, runner config.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { rpcOk, sendJson } from "./underlying/http-json.js";
import { searchNoemaMemories } from "./host-feature-bridge.js";
import {
  dropEmbeddedVectorRow,
  memoryEmbeddingsStatus,
  searchMemoryEmbeddings,
  searchMemoryEmbeddingsAsync,
  syncEmbeddedVectorRow,
} from "./memory-embeddings.js";
import { searchEmbeddedVectorStore } from "./embedded-vector-store.js";
import { honestReady } from "./honest-envelope.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface NoemaOptions {
  readonly xrkHome?: string;
}

interface NoemaState {
  enabled: boolean;
  running: boolean;
  writable: boolean;
  lastRunAt: string | null;
}

interface NoemaMemory {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}

interface NoemaMemoryIndex {
  memories: NoemaMemory[];
  maxEntries: number;
}

const STATE_STORE = createXrkDocStore<NoemaState>(
  ["noema", "state.json"],
  {
    enabled: false,
    running: false,
    writable: true,
    lastRunAt: null,
  },
);

const MEMORY_STORE = createXrkDocStore<NoemaMemoryIndex>(
  ["noema", "memories.json"],
  { memories: [], maxEntries: 256 },
);

function loadState(options: NoemaOptions): NoemaState {
  return STATE_STORE.read(options.xrkHome).data;
}

function saveState(options: NoemaOptions, state: NoemaState): NoemaState {
  return STATE_STORE.write(options.xrkHome, state).data;
}

function loadMemories(options: NoemaOptions): NoemaMemoryIndex {
  return MEMORY_STORE.read(options.xrkHome).data;
}

function saveMemories(
  options: NoemaOptions,
  index: NoemaMemoryIndex,
): NoemaMemoryIndex {
  return MEMORY_STORE.write(options.xrkHome, index).data;
}

function statusPayload(options: NoemaOptions): Record<string, unknown> {
  const state = loadState(options);
  const memories = loadMemories(options);
  return {
    ok: true,
    writable: state.writable,
    running: state.running,
    config: {
      enabled: state.enabled,
      lastRunAt: state.lastRunAt,
      memoryCount: memories.memories.length,
      maxEntries: memories.maxEntries,
    },
    ...honestReady(),
  };
}

export function handleNoemaRpc(
  endpoint: string,
  payload: Record<string, unknown>,
  options: NoemaOptions,
): Record<string, unknown> {
  const state = loadState(options);

  if (
    endpoint === "status" ||
    endpoint === "get" ||
    endpoint === "describe" ||
    endpoint === ""
  ) {
    return statusPayload(options);
  }

  if (endpoint === "memory.list" || endpoint === "memories.list") {
    const memories = loadMemories(options);
    return {
      ok: true,
      memories: memories.memories,
      maxEntries: memories.maxEntries,
    };
  }

  if (endpoint === "memory.add" || endpoint === "memories.add") {
    const text =
      typeof payload.text === "string"
        ? payload.text.trim()
        : typeof payload.content === "string"
          ? payload.content.trim()
          : "";
    if (!text) {
      return { ok: false, code: "empty-memory" };
    }
    const tags = Array.isArray(payload.tags)
      ? payload.tags.map((t) => String(t))
      : [];
    const memories = loadMemories(options);
    const row: NoemaMemory = {
      id: randomUUID(),
      text,
      tags,
      createdAt: new Date().toISOString(),
    };
    const next = saveMemories(options, {
      ...memories,
      memories: [row, ...memories.memories].slice(0, memories.maxEntries),
    });
    syncEmbeddedVectorRow(options.xrkHome, row);
    return { ok: true, memory: row, total: next.memories.length };
  }

  if (endpoint === "memory.delete" || endpoint === "memories.delete") {
    const id =
      typeof payload.id === "string"
        ? payload.id
        : typeof payload.memoryId === "string"
          ? payload.memoryId
          : "";
    const memories = loadMemories(options);
    const next = saveMemories(options, {
      ...memories,
      memories: memories.memories.filter((m) => m.id !== id),
    });
    dropEmbeddedVectorRow(options.xrkHome, id);
    return { ok: true, total: next.memories.length };
  }

  if (endpoint === "memory.search" || endpoint === "memories.search") {
    const query =
      typeof payload.query === "string"
        ? payload.query
        : typeof payload.q === "string"
          ? payload.q
          : "";
    const memories = loadMemories(options);
    const hits = searchNoemaMemories(memories.memories, query);
    return {
      ok: true,
      query,
      hits,
      mode: "keyword",
      note: "Keyword search via XRK bridge (no embedding host).",
    };
  }

  if (endpoint === "embedding.search" || endpoint === "embeddings.search") {
    const query =
      typeof payload.query === "string"
        ? payload.query
        : typeof payload.q === "string"
          ? payload.q
          : "";
    const limit =
      typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? payload.limit
        : 16;
    const memories = loadMemories(options);
    const embeddedHits = searchEmbeddedVectorStore(
      options.xrkHome,
      query,
      limit,
    );
    if (embeddedHits.length > 0) {
      return {
        ok: true,
        query,
        hits: embeddedHits,
        mode: "embedded-host",
        ...memoryEmbeddingsStatus(options.xrkHome),
      };
    }
    const hits = searchMemoryEmbeddings(memories.memories, query, limit);
    return {
      ok: true,
      query,
      hits,
      mode: "local-embedding-bridge",
      ...memoryEmbeddingsStatus(options.xrkHome),
    };
  }

  if (
    endpoint === "embedding.status" ||
    endpoint === "embeddings.status" ||
    endpoint === "embedding.describe"
  ) {
    return memoryEmbeddingsStatus(options.xrkHome);
  }

  if (endpoint === "runner.start" || endpoint === "start") {
    if (!state.enabled) {
      return {
        ok: false,
        code: "disabled",
        running: false,
        note: "Enable noema in settings before starting runner.",
      };
    }
    const next = saveState(options, {
      ...state,
      running: true,
      lastRunAt: new Date().toISOString(),
    });
    return {
      ok: true,
      running: next.running,
      lastRunAt: next.lastRunAt,
      note: "Runner flag persisted; indexing uses keyword bridge.",
    };
  }

  if (endpoint === "runner.stop" || endpoint === "stop") {
    const next = saveState(options, { ...state, running: false });
    return { ok: true, running: next.running };
  }

  if (endpoint === "set" || endpoint === "apply" || endpoint === "patch") {
    const patch =
      payload.patch && typeof payload.patch === "object"
        ? (payload.patch as Record<string, unknown>)
        : payload;
    const next = { ...state };
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (typeof patch.running === "boolean") next.running = patch.running;
    saveState(options, next);
    return statusPayload(options);
  }

  return honestReady({ endpoint });
}

export async function handleNoemaRpcAsync(
  endpoint: string,
  payload: Record<string, unknown>,
  options: NoemaOptions,
): Promise<Record<string, unknown>> {
  if (endpoint === "embedding.search" || endpoint === "embeddings.search") {
    const query =
      typeof payload.query === "string"
        ? payload.query
        : typeof payload.q === "string"
          ? payload.q
          : "";
    const limit =
      typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? payload.limit
        : 16;
    const memories = loadMemories(options);
    const { hits, mode } = await searchMemoryEmbeddingsAsync(
      memories.memories,
      query,
      limit,
      process.env,
      options.xrkHome,
    );
    return {
      ok: true,
      query,
      hits,
      mode,
      ...memoryEmbeddingsStatus(options.xrkHome),
    };
  }
  return handleNoemaRpc(endpoint, payload, options);
}

export async function handleNoemaHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: NoemaOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/_dsh/dsh-noema")) return false;
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/_dsh/dsh-noema/status") {
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      if (typeof body.rpcId === "string") {
        const rpcMethod =
          typeof body.method === "string" ? body.method : "status";
        const payload =
          body.payload && typeof body.payload === "object"
            ? (body.payload as Record<string, unknown>)
            : {};
        sendJson(
          res,
          200,
          rpcOk(
            body.rpcId,
            await handleNoemaRpcAsync(rpcMethod, payload, options),
          ),
        );
        return true;
      }
      const state = loadState(options);
      if (typeof body.enabled === "boolean") state.enabled = body.enabled;
      if (typeof body.running === "boolean") state.running = body.running;
      if (body.running === true) state.lastRunAt = new Date().toISOString();
      saveState(options, state);
    }
    sendJson(res, 200, statusPayload(options));
    return true;
  }

  if (pathname === "/_dsh/dsh-noema/memories") {
    if (method === "GET") {
      const memories = loadMemories(options);
      sendJson(res, 200, {
        ok: true,
        memories: memories.memories,
        maxEntries: memories.maxEntries,
      });
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      sendJson(res, 200, handleNoemaRpc("memory.add", body, options));
      return true;
    }
  }

  sendJson(res, 200, statusPayload(options));
  return true;
}

export function isNoemaPath(pathname: string): boolean {
  return pathname.startsWith("/_dsh/dsh-noema");
}
