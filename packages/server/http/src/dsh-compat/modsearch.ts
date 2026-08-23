/**
 * @liustack/modsearch — file-backed search engine config (`~/.xrk/modsearch/config.json`).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { readBody, rpcOk, sendJson } from "../http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import {
  honestReady,
} from "./honest-envelope.js";
import { runModsearchQuery } from "./host-feature-bridge.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

const ENGINES = [
  "antigravity-cli",
  "tavily",
  "exa",
  "firecrawl",
  "grok-cli",
  "local",
] as const;

const KEYED = ["tavily", "exa", "firecrawl", "grok-cli"] as const;
const MODELLED = ["antigravity-cli", "grok-cli"] as const;

export interface ModsearchOptions {
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
}

interface EngineRow {
  baseURL?: string;
  model?: string;
  enabled?: boolean;
  apiKey?: string;
}

interface ModsearchStore {
  engine: string;
  engines: Record<string, EngineRow>;
}

function defaultStore(): ModsearchStore {
  return { engine: "", engines: {} };
}

const MODSEARCH_STORE = createXrkDocStore(
  ["modsearch", "config.json"],
  defaultStore(),
);

function load(xrkHome?: string): ModsearchStore {
  return MODSEARCH_STORE.read(xrkHome).data;
}

function save(xrkHome: string | undefined, store: ModsearchStore): number {
  return MODSEARCH_STORE.write(xrkHome, store).revision;
}

function cliOnPath(cmd: string): boolean {
  try {
    execFileSync(
      process.platform === "win32" ? "where" : "which",
      [cmd],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function probeReadiness(): Array<{ engine: string; ready: boolean }> {
  return ENGINES.filter((e) => e !== "local").map((engine) => {
    let ready = false;
    if (engine === "tavily" || engine === "exa" || engine === "firecrawl") {
      ready = true;
    } else if (engine === "grok-cli") {
      ready = cliOnPath("grok");
    } else if (engine === "antigravity-cli") {
      ready = cliOnPath("antigravity") || cliOnPath("ag");
    }
    return { engine, ready };
  });
}

function summaryFromStore(
  store: ModsearchStore,
  doctor: boolean,
  revision?: number,
): Record<string, unknown> {
  const engines: Record<string, EngineRow> = {};
  for (const name of ENGINES) {
    const row = store.engines[name] ?? {};
    engines[name] = {
      baseURL: row.baseURL ?? "",
      model: row.model ?? "",
      enabled: row.enabled !== false,
    };
  }
  return {
    engine: store.engine ?? "",
    keyed: [...KEYED],
    models: [...MODELLED],
    engines,
    adapter: DSH_COMPAT_ADAPTER,
    ...(doctor ? { readiness: probeReadiness() } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

function applySave(
  store: ModsearchStore,
  body: Record<string, unknown>,
): ModsearchStore {
  const next: ModsearchStore = {
    engine: store.engine,
    engines: { ...store.engines },
  };
  if (typeof body.engine === "string") {
    next.engine = body.engine;
  }
  if (body.enabled && typeof body.enabled === "object") {
    for (const [name, on] of Object.entries(
      body.enabled as Record<string, unknown>,
    )) {
      const row = { ...(next.engines[name] ?? {}) };
      row.enabled = on !== false;
      next.engines[name] = row;
    }
  }
  const target =
    typeof body.target === "string" && body.target
      ? body.target
      : undefined;
  if (target) {
    const row = { ...(next.engines[target] ?? {}) };
    if (typeof body.baseURL === "string") row.baseURL = body.baseURL;
    if (typeof body.model === "string") row.model = body.model;
    if (typeof body.apiKey === "string" && body.apiKey) {
      row.apiKey = body.apiKey;
    }
    next.engines[target] = row;
  }
  return next;
}

export async function handleModsearchRpc(
  endpoint: string,
  payload: Record<string, unknown>,
  options: ModsearchOptions & { readonly workspaceRoot?: string },
): Promise<Record<string, unknown>> {
  const home = options.xrkHome;
  if (
    endpoint === "config" ||
    endpoint === "get" ||
    endpoint === "describe" ||
    endpoint === "status" ||
    endpoint === ""
  ) {
    const discover =
      payload.discover === true ||
      payload.doctor === true ||
      payload.doctor === 1;
    return summaryFromStore(load(home), discover);
  }
  if (endpoint === "set" || endpoint === "apply" || endpoint === "patch") {
    const patch =
      payload.patch && typeof payload.patch === "object"
        ? (payload.patch as Record<string, unknown>)
        : payload;
    const store = applySave(load(home), patch);
    const revision = save(home, store);
    return summaryFromStore(store, false, revision);
  }
  if (
    endpoint === "search" ||
    endpoint === "query" ||
    endpoint === "doctor"
  ) {
    const store = load(home);
    const query = String(payload.query ?? payload.q ?? "");
    if (endpoint === "doctor") {
      return summaryFromStore(store, true);
    }
    const engine =
      typeof payload.engine === "string" && payload.engine
        ? payload.engine
        : store.engine || "local";
    return runModsearchQuery(query, {
      ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
      engine,
      engines: store.engines,
    });
  }
  return honestReady({ endpoint });
}

export async function handleModsearchHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: ModsearchOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/modsearch")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const home = options.xrkHome;

  if (pathname === "/modsearch/config") {
    if (method === "GET" || method === "HEAD") {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const doctor = url.searchParams.get("doctor") === "1";
      sendJson(res, 200, summaryFromStore(load(home), doctor));
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      if (typeof body.rpcId === "string") {
        const rpcMethod =
          typeof body.method === "string" ? body.method : "config";
        const payload =
          body.payload && typeof body.payload === "object"
            ? (body.payload as Record<string, unknown>)
            : body;
        sendJson(
          res,
          200,
          rpcOk(
            body.rpcId,
            await handleModsearchRpc(rpcMethod, payload, options),
          ),
        );
        return true;
      }
      const store = applySave(load(home), body);
      const revision = save(home, store);
      sendJson(res, 200, summaryFromStore(store, false, revision));
      return true;
    }
  }

  if (pathname === "/modsearch/search" || pathname === "/modsearch/query") {
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const store = load(home);
      const query = String(body.query ?? body.q ?? "");
      const engine =
        typeof body.engine === "string" && body.engine
          ? body.engine
          : store.engine || "local";
      sendJson(
        res,
        200,
        await runModsearchQuery(query, {
          ...(options.workspaceRoot
            ? { workspaceRoot: options.workspaceRoot }
            : {}),
          engine,
          engines: store.engines,
        }),
      );
      return true;
    }
  }

  if (pathname === "/modsearch/doctor") {
    sendJson(res, 200, summaryFromStore(load(home), true));
    return true;
  }

  if (method === "POST" || method === "PUT") await readBody(req);
  sendJson(res, 200, honestReady({ path: pathname }));
  return true;
}

export function isModsearchPath(pathname: string): boolean {
  return pathname.startsWith("/modsearch");
}
