/**
 * dsh-chat-import — file-backed sync config + generic session discovery/import.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, isMutatingMethod, parseJsonBody } from "./underlying/http-kit.js";
import {
  CHAT_IMPORT_SOURCE_FORMAT,
  discoverChatImportSessionsAsync,
  importFingerprint,
  type ChatImportFormat,
} from "./chat-import-discovery.js";
import {
  loadImportRegistry,
  registryStatusMap,
  upsertImportRow,
} from "./chat-import-registry.js";

export interface ChatImportOptions {
  readonly xrkHome?: string;
}

interface SyncDirection {
  enabled: boolean;
  formats?: string[];
  targets?: string[];
  excludeDirs: string[];
}

interface ChatImportConfig {
  inbound: SyncDirection;
  outbound: SyncDirection & { targets: string[] };
  intervalMs: number;
  lastRun: { at: string | null };
}

interface ChatImportState {
  config: ChatImportConfig;
  lastError: string | null;
}

const DEFAULT_CONFIG: ChatImportConfig = {
  inbound: { enabled: false, formats: [], excludeDirs: [] },
  outbound: { enabled: false, targets: [], excludeDirs: [] },
  intervalMs: 60_000,
  lastRun: { at: null },
};

const EMPTY_STATE: ChatImportState = {
  config: DEFAULT_CONFIG,
  lastError: null,
};

const CHAT_IMPORT_STORE = createXrkDocStore(
  ["chat-import", "state.json"],
  EMPTY_STATE,
);

function normalizeConfig(raw: unknown): ChatImportConfig {
  const base = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Record<string, unknown>;
  const inbound =
    row.inbound && typeof row.inbound === "object"
      ? (row.inbound as Record<string, unknown>)
      : {};
  const outbound =
    row.outbound && typeof row.outbound === "object"
      ? (row.outbound as Record<string, unknown>)
      : {};
  return {
    inbound: {
      enabled: inbound.enabled === true,
      formats: Array.isArray(inbound.formats)
        ? inbound.formats.filter((f): f is string => typeof f === "string")
        : [],
      excludeDirs: Array.isArray(inbound.excludeDirs)
        ? inbound.excludeDirs.filter((d): d is string => typeof d === "string")
        : [],
    },
    outbound: {
      enabled: outbound.enabled === true,
      targets: Array.isArray(outbound.targets)
        ? outbound.targets.filter((t): t is string => typeof t === "string")
        : [],
      excludeDirs: Array.isArray(outbound.excludeDirs)
        ? outbound.excludeDirs.filter((d): d is string => typeof d === "string")
        : [],
    },
    intervalMs:
      typeof row.intervalMs === "number" && row.intervalMs >= 15_000
        ? row.intervalMs
        : DEFAULT_CONFIG.intervalMs,
    lastRun: {
      at:
        row.lastRun &&
        typeof row.lastRun === "object" &&
        typeof (row.lastRun as { at?: unknown }).at === "string"
          ? String((row.lastRun as { at: string }).at)
          : null,
    },
  };
}

function mergeConfig(
  current: ChatImportConfig,
  patch: Record<string, unknown>,
): ChatImportConfig {
  const next = normalizeConfig(current);
  if (patch.inbound && typeof patch.inbound === "object") {
    const inbound = patch.inbound as Record<string, unknown>;
    next.inbound = {
      ...next.inbound,
      ...(typeof inbound.enabled === "boolean"
        ? { enabled: inbound.enabled }
        : {}),
      ...(Array.isArray(inbound.formats)
        ? {
            formats: inbound.formats.filter(
              (f): f is string => typeof f === "string",
            ),
          }
        : {}),
      ...(Array.isArray(inbound.excludeDirs)
        ? {
            excludeDirs: inbound.excludeDirs.filter(
              (d): d is string => typeof d === "string",
            ),
          }
        : {}),
    };
  }
  if (patch.outbound && typeof patch.outbound === "object") {
    const outbound = patch.outbound as Record<string, unknown>;
    next.outbound = {
      ...next.outbound,
      ...(typeof outbound.enabled === "boolean"
        ? { enabled: outbound.enabled }
        : {}),
      ...(Array.isArray(outbound.targets)
        ? {
            targets: outbound.targets.filter(
              (t): t is string => typeof t === "string",
            ),
          }
        : {}),
      ...(Array.isArray(outbound.excludeDirs)
        ? {
            excludeDirs: outbound.excludeDirs.filter(
              (d): d is string => typeof d === "string",
            ),
          }
        : {}),
    };
  }
  if (typeof patch.intervalMs === "number" && patch.intervalMs >= 15_000) {
    next.intervalMs = patch.intervalMs;
  }
  return next;
}

function sourceToFormat(source: string): ChatImportFormat | undefined {
  return CHAT_IMPORT_SOURCE_FORMAT[source];
}

async function runInboundScan(options: ChatImportOptions): Promise<{
  scanned: number;
  imported: number;
  skipped: number;
}> {
  const registry = loadImportRegistry(options.xrkHome);
  const found = await discoverChatImportSessionsAsync({
    ...(options.xrkHome ? { xrkHome: options.xrkHome } : {}),
    imports: registryStatusMap(registry),
  });
  return {
    scanned: found.total,
    imported: 0,
    skipped: found.total,
  };
}

export async function handleChatImportHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: ChatImportOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/api-import")) return false;
  const method = httpMethod(req);
  let state = CHAT_IMPORT_STORE.read(options.xrkHome).data;
  if (!("config" in state) || !state.config) {
    const legacy = state as unknown as {
      enabled?: boolean;
      sources?: unknown[];
      lastSyncAt?: string | null;
      lastError?: string | null;
    };
    state = {
      config: normalizeConfig({
        inbound: { enabled: legacy.enabled === true, formats: [], excludeDirs: [] },
        outbound: { enabled: false, targets: [], excludeDirs: [] },
        intervalMs: DEFAULT_CONFIG.intervalMs,
        lastRun: { at: legacy.lastSyncAt ?? null },
      }),
      lastError: legacy.lastError ?? null,
    };
  }
  state = {
    ...state,
    config: normalizeConfig(state.config),
  };

  if (pathname === "/api-import/sessions" && method === "POST") {
    const body = await parseJsonBody(req);
    const source =
      typeof body.source === "string" && body.source ? body.source : "";
    const format = source ? sourceToFormat(source) : undefined;
    if (source && !format) {
      sendJson(res, 400, { ok: false, error: `未知来源: ${source}` });
      return true;
    }
    const offset =
      typeof body.offset === "number" && Number.isFinite(body.offset)
        ? Math.max(0, Math.trunc(body.offset))
        : 0;
    const limit =
      typeof body.limit === "number" && body.limit > 0
        ? Math.trunc(body.limit)
        : undefined;
    const registry = loadImportRegistry(options.xrkHome);
    const found = await discoverChatImportSessionsAsync({
      ...(format ? { format } : {}),
      ...(typeof body.path === "string" && body.path.trim()
        ? { path: body.path.trim() }
        : {}),
      ...(typeof body.query === "string" ? { query: body.query } : {}),
      ...(options.xrkHome ? { xrkHome: options.xrkHome } : {}),
      imports: registryStatusMap(registry),
    });
    const all = found.sessions;
    const sessions =
      limit === undefined ? all : all.slice(offset, offset + limit);
    sendJson(res, 200, {
      ok: true,
      sessions,
      total: found.total,
      offset,
      limit: limit ?? all.length,
    });
    return true;
  }

  if (pathname === "/api-import/import" && method === "POST") {
    const body = await parseJsonBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      sendJson(res, 400, {
        ok: false,
        error: "items 为空：请选择要导入的会话",
      });
      return true;
    }
    const results: Record<string, unknown>[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const source =
        typeof (item as { source?: unknown }).source === "string"
          ? (item as { source: string }).source
          : "";
      const format = sourceToFormat(source);
      const sourcePath =
        typeof (item as { sourcePath?: unknown }).sourcePath === "string"
          ? (item as { sourcePath: string }).sourcePath
          : "";
      const sessionId =
        typeof (item as { sessionId?: unknown }).sessionId === "string"
          ? (item as { sessionId: string }).sessionId
          : "";
      if (!format || !sourcePath) {
        results.push({
          status: "failed",
          error: "missing source or sourcePath",
        });
        continue;
      }
      if (!existsSync(sourcePath)) {
        results.push({
          sourcePath,
          format,
          status: "failed",
          error: "source file missing",
        });
        continue;
      }
      const fingerprint = importFingerprint({
        format,
        sessionId: sessionId || sourcePath,
        sourcePath,
      });
      const registry = loadImportRegistry(options.xrkHome);
      if (registry.imports[fingerprint]?.status === "imported") {
        results.push({
          sourcePath,
          format,
          status: "already-imported",
          alreadyImported: true,
        });
        continue;
      }
      upsertImportRow(options.xrkHome, {
        format,
        sourcePath,
        sessionId: sessionId || sourcePath,
        status: "imported",
        note: "metadata registered on XRK bridge; transcript import uses same fingerprint as dsh-chat-import",
      });
      results.push({
        sourcePath,
        format,
        mode: "single",
        status: "imported",
        sessionId: sessionId || sourcePath,
      });
    }
    sendJson(res, 200, { ok: true, results });
    return true;
  }

  if (pathname === "/api-import/sync") {
    if (isMutatingMethod(method)) {
      const body = await parseJsonBody(req);
      const runNow = body.runNow === true;
      const saved = CHAT_IMPORT_STORE.patch(options.xrkHome, (current) => {
        const config = mergeConfig(
          normalizeConfig(current.config),
          body,
        );
        if (runNow) {
          config.lastRun = { at: new Date().toISOString() };
        }
        return {
          config,
          lastError: null,
        };
      });
      state = {
        ...saved.data,
        config: normalizeConfig(saved.data.config),
      };
      const scan = runNow ? await runInboundScan(options) : undefined;
      sendJson(res, 200, {
        ok: true,
        config: state.config,
        status: {
          ready:
            state.config.inbound.enabled || state.config.outbound.enabled,
          lastSyncAt: state.config.lastRun.at,
          lastError: state.lastError,
        },
        ...(runNow && scan
          ? {
              result: {
                inbound: scan,
                outbound: { scanned: 0, exported: 0, skipped: 0 },
              },
            }
          : {}),
        revision: saved.revision,
      });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      config: state.config,
      status: {
        ready: state.config.inbound.enabled || state.config.outbound.enabled,
        lastSyncAt: state.config.lastRun.at,
        lastError: state.lastError,
      },
    });
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    config: state.config,
    status: {
      ready: state.config.inbound.enabled || state.config.outbound.enabled,
      lastSyncAt: state.config.lastRun.at,
    },
  });
  return true;
}

export function isChatImportPath(pathname: string): boolean {
  return pathname.startsWith("/api-import");
}
