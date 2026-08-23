/**
 * dsh-chat-import — file-backed import sources + sync status.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, isMutatingMethod, parseJsonBody } from "./underlying/http-kit.js";

export interface ChatImportOptions {
  readonly xrkHome?: string;
}

interface ChatImportState {
  enabled: boolean;
  sources: Array<{ id: string; kind: string; label: string; enabled: boolean }>;
  lastSyncAt: string | null;
  lastError: string | null;
}

const EMPTY_STATE: ChatImportState = {
  enabled: false,
  sources: [],
  lastSyncAt: null,
  lastError: null,
};

const CHAT_IMPORT_STORE = createXrkDocStore(
  ["chat-import", "state.json"],
  EMPTY_STATE,
);

export async function handleChatImportHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: ChatImportOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/api-import")) return false;
  const method = httpMethod(req);
  let state = CHAT_IMPORT_STORE.read(options.xrkHome).data;
  let revision: number | undefined;

  if (pathname === "/api-import/sync") {
    if (isMutatingMethod(method)) {
      const body = await parseJsonBody(req);
      const saved = CHAT_IMPORT_STORE.patch(options.xrkHome, (current) => {
        const next = { ...current };
        if (typeof body.enabled === "boolean") next.enabled = body.enabled;
        if (Array.isArray(body.sources)) {
          next.sources = body.sources.filter(
            (s): s is ChatImportState["sources"][number] =>
              !!s &&
              typeof s === "object" &&
              typeof (s as { id?: string }).id === "string",
          );
        }
        next.lastSyncAt = new Date().toISOString();
        next.lastError = null;
        return next;
      });
      state = saved.data;
      revision = saved.revision;
    }
    sendJson(res, 200, {
      ok: true,
      config: { enabled: state.enabled, sources: state.sources },
      status: {
        ready: state.enabled && state.sources.some((s) => s.enabled),
        lastSyncAt: state.lastSyncAt,
        lastError: state.lastError,
      },
      ...(revision !== undefined ? { revision } : {}),
    });
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    config: { enabled: state.enabled, sources: state.sources },
    status: { ready: state.enabled, lastSyncAt: state.lastSyncAt },
  });
  return true;
}

export function isChatImportPath(pathname: string): boolean {
  return pathname.startsWith("/api-import");
}
