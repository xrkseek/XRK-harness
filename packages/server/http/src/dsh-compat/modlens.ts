/**
 * dsh-modlens — persisted engine config + CLI discovery.
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { rpcOk, sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface ModlensOptions {
  readonly xrkHome?: string;
}

interface ModlensState {
  provider: string;
  engines: Record<string, { enabled: boolean; path?: string }>;
  reuse: Record<string, boolean>;
}

type ModlensPublic = ModlensState & {
  discover?: Array<{ id: string; path: string }>;
  ok?: boolean;
  adapter?: string;
};

const ENGINE_IDS = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "grok",
] as const;

function defaultState(): ModlensState {
  return {
    provider: "",
    engines: {},
    reuse: {
      claude: false,
      codex: false,
      opencode: false,
      pi: false,
      grok: false,
    },
  };
}

const MODLENS_STORE = createXrkDocStore(
  ["modlens", "config.json"],
  defaultState(),
);

function loadState(options: ModlensOptions): ModlensState {
  return { ...defaultState(), ...MODLENS_STORE.read(options.xrkHome).data };
}

function saveState(options: ModlensOptions, state: ModlensState): number {
  return MODLENS_STORE.write(options.xrkHome, state).revision;
}

function which(cmd: string): string | undefined {
  try {
    const exe = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(exe, [cmd], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    return first && existsSync(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

function discoverEngines(): Array<{ id: string; path: string }> {
  const found: Array<{ id: string; path: string }> = [];
  for (const id of ENGINE_IDS) {
    const hit = which(id);
    if (hit) found.push({ id, path: hit });
  }
  return found;
}

/** Heuristic paste preview — not Cordis ModLens analysis host. */
export function parseModlensPastePreview(
  text: string,
): Array<{ kind: string; value: string }> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const items: Array<{ kind: string; value: string }> = [];
  const seen = new Set<string>();

  for (const match of trimmed.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const value = match[0];
    if (seen.has(value)) continue;
    seen.add(value);
    items.push({ kind: "url", value });
  }

  for (const id of ENGINE_IDS) {
    if (new RegExp(`\\b${id}\\b`, "i").test(trimmed)) {
      items.push({ kind: "engine", value: id });
    }
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1) {
    items.push({ kind: "lines", value: String(lines.length) });
  }

  const modelLike = trimmed.match(
    /\b(gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|deepseek-[\w.-]+)\b/gi,
  );
  if (modelLike) {
    for (const value of modelLike) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "model", value });
    }
  }

  return items;
}

function bareConfig(
  value: Record<string, unknown>,
): Pick<ModlensPublic, "provider" | "engines" | "reuse" | "discover"> {
  return {
    provider: value.provider as string,
    engines: value.engines as ModlensState["engines"],
    reuse: value.reuse as ModlensState["reuse"],
    discover: (value.discover as ModlensPublic["discover"]) ?? [],
  };
}

/** Cordis RPC channel `/modlens` (POST `/modlens/config` · `/modlens/paste`). */
export function handleModlensRpc(
  endpoint: string,
  payload: Record<string, unknown>,
  options: ModlensOptions,
): Record<string, unknown> {
  const state = loadState(options);
  if (
    endpoint === "config" ||
    endpoint === "get" ||
    endpoint === "describe" ||
    endpoint === ""
  ) {
    const discover =
      payload.discover === true || payload.discover === 1;
    return {
      ok: true,
      provider: state.provider,
      engines: state.engines,
      reuse: state.reuse,
      discover: discover ? discoverEngines() : [],
      adapter: DSH_COMPAT_ADAPTER,
    };
  }
  if (endpoint === "set" || endpoint === "apply" || endpoint === "patch") {
    const patch =
      payload.patch && typeof payload.patch === "object"
        ? (payload.patch as Record<string, unknown>)
        : payload;
    if (typeof patch.provider === "string") state.provider = patch.provider;
    if (patch.engines && typeof patch.engines === "object") {
      state.engines = {
        ...state.engines,
        ...(patch.engines as Record<string, { enabled: boolean; path?: string }>),
      };
    }
    if (patch.reuse && typeof patch.reuse === "object") {
      state.reuse = {
        ...state.reuse,
        ...(patch.reuse as Record<string, boolean>),
      };
    }
    saveState(options, state);
    return {
      ok: true,
      ...state,
      discover: discoverEngines(),
      adapter: DSH_COMPAT_ADAPTER,
    };
  }
  if (endpoint === "paste") {
    const text =
      typeof payload.text === "string"
        ? payload.text
        : typeof payload.content === "string"
          ? payload.content
          : typeof payload.paste === "string"
            ? payload.paste
            : "";
    const items = parseModlensPastePreview(text);
    return tag(
      {
        ok: true,
        provider: state.provider,
        engines: state.engines,
        reuse: state.reuse,
        items,
        discover: discoverEngines(),
        preview: true,
        adapter: DSH_COMPAT_ADAPTER,
        note: items.length
          ? "Heuristic paste preview via XRK bridge."
          : "Empty paste — no preview items.",
      },
      ["modlens-host"],
    );
  }
  return {
    ok: true,
    endpoint,
    provider: state.provider,
    engines: state.engines,
    reuse: state.reuse,
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export async function handleModlensHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: ModlensOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/modlens")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const endpoint = pathname.replace(/^\/modlens\/?/, "") || "config";

  let body: Record<string, unknown> = {};
  if (method === "POST" || method === "PUT") {
    body = await parseJsonBody(req);
    if (typeof body.rpcId === "string") {
      const rpcMethod =
        typeof body.method === "string" ? body.method : endpoint;
      const payload =
        body.payload && typeof body.payload === "object"
          ? (body.payload as Record<string, unknown>)
          : {};
      sendJson(
        res,
        200,
        rpcOk(body.rpcId, handleModlensRpc(rpcMethod, payload, options)),
      );
      return true;
    }
  }

  if (
    method === "GET" &&
    (endpoint === "config" || endpoint.startsWith("config"))
  ) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const discover = url.searchParams.get("discover") === "1";
    sendJson(
      res,
      200,
      bareConfig(handleModlensRpc("config", { discover }, options)),
    );
    return true;
  }

  if (method === "POST" || method === "PUT") {
    const rpcEndpoint =
      endpoint === "config" || endpoint.startsWith("config") ? "set" : endpoint;
    sendJson(res, 200, handleModlensRpc(rpcEndpoint, body, options));
    return true;
  }

  sendJson(
    res,
    200,
    bareConfig(handleModlensRpc("config", { discover: true }, options)),
  );
  return true;
}

export function isModlensPath(pathname: string): boolean {
  return pathname.startsWith("/modlens");
}
