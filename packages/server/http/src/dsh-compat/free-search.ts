/**
 * `dsh-free-search` — `/api/dsh-free-search-settings/*` describe/mutate + raw-search.
 * Keyless `ddg` uses `@xrkseek/exec-web` DuckDuckGo HTML search.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createDuckDuckGoSearch } from "@xrkseek/exec-web";
import { sendJson } from "./underlying/http-json.js";
import { createPersistedSettingsDocStore } from "./persisted-settings-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface FreeSearchOptions {
  readonly xrkHome?: string;
  /** Injected for tests — defaults to DuckDuckGo HTML search. */
  readonly search?: {
    search(
      request: { query: string; maxResults: number },
      signal?: AbortSignal,
    ): Promise<{
      sources: ReadonlyArray<{
        url: string;
        title?: string;
        snippet?: string;
        publishedAt?: string;
      }>;
      truncated: boolean;
      content?: string;
    }>;
  };
}

const NS = "web-search-free";

const DEFAULTS: Record<string, unknown> = {
  provider: "ddg",
  lang: "zh",
  keyStorage: "credentials",
  safeSearch: "off",
  bingMarket: "zh-CN",
  anysearchApiKey: "",
  exaApiKey: "",
  tavilyApiKey: "",
  keenableApiKey: "",
  firecrawlApiKey: "",
  parallelApiKey: "",
  perplexityApiKey: "",
  serpbaseApiKey: "",
};

const KEY_FIELDS = [
  "anysearchApiKey",
  "exaApiKey",
  "tavilyApiKey",
  "keenableApiKey",
  "firecrawlApiKey",
  "parallelApiKey",
  "perplexityApiKey",
  "serpbaseApiKey",
] as const;

function storeFor(xrkHome?: string) {
  return createPersistedSettingsDocStore(xrkHome, NS, DEFAULTS);
}

function describeBody(xrkHome?: string): Record<string, unknown> {
  const store = storeFor(xrkHome);
  return {
    ok: true,
    value: {
      writable: true,
      namespaces: [
        {
          ns: NS,
          value: store.value(),
          base: store.base(),
          user: store.user(),
          revision: store.revision(),
        },
      ],
    },
    adapter: DSH_COMPAT_ADAPTER,
  };
}

function credentialsConfigured(
  value: Record<string, unknown>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of KEY_FIELDS) {
    const raw = value[key];
    out[key] = typeof raw === "string" && raw.trim().length > 0;
  }
  return out;
}

function resolveProvider(settings: Record<string, unknown>): string {
  const raw =
    typeof settings.provider === "string" ? settings.provider.trim() : "ddg";
  return raw || "ddg";
}

/** Keyless providers we can run in-process; keyed engines stay deferred. */
function isKeylessProvider(provider: string): boolean {
  const id = provider.toLowerCase();
  return id === "ddg" || id === "duckduckgo" || id === "parallel-free";
}

export function isFreeSearchPath(pathname: string): boolean {
  return (
    pathname === "/api/dsh-free-search-settings" ||
    pathname.startsWith("/api/dsh-free-search-settings/")
  );
}

export async function handleFreeSearchHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: FreeSearchOptions = {},
): Promise<boolean> {
  if (!isFreeSearchPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const rel = pathname.replace(/^\/api\/dsh-free-search-settings\/?/, "/");

  if (rel === "/describe" || rel === "/" || rel === "") {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, describeBody(xrkHome));
    return true;
  }

  if (rel === "/mutate") {
    const body = await parseJsonBody(req);
    const store = storeFor(xrkHome);
    const ops = Array.isArray(body.ops) ? body.ops : [];
    if (ops.length > 0) store.applyOps(ops);
    if (body.document && typeof body.document === "object") {
      store.replaceUser(body.document as Record<string, unknown>);
    }
    sendJson(res, 200, {
      ok: true,
      value: {
        value: store.value(),
        writable: true,
        revision: store.revision(),
        namespaces: [
          {
            ns: NS,
            value: store.value(),
            revision: store.revision(),
          },
        ],
      },
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/credentials-status") {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    const value = storeFor(xrkHome).value();
    sendJson(res, 200, {
      ok: true,
      configured: credentialsConfigured(value),
      adapter: DSH_COMPAT_ADAPTER,
      note: "Reports non-empty keys stored in settings; credential-center refs stay separate.",
    });
    return true;
  }

  if (rel === "/credentials-set") {
    await parseJsonBody(req);
    sendJson(res, 200, {
      ok: false,
      error: "credentials-unavailable",
      message:
        "Use Settings keyStorage=settings or Host credentials file; bridge set is not embedded.",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/raw-search") {
    const body = await parseJsonBody(req);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      sendJson(res, 200, {
        ok: false,
        code: "search-rejected",
        message: "malformed bridge search request (query is required)",
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    const settings = storeFor(xrkHome).value();
    const requested =
      typeof body.engine === "string" && body.engine.trim()
        ? body.engine.trim()
        : typeof body.provider === "string" && body.provider.trim()
          ? body.provider.trim()
          : resolveProvider(settings);
    const maxResults = Math.min(
      Math.max(Number(body.maxResults) || 5, 1),
      10,
    );

    if (!isKeylessProvider(requested)) {
      sendJson(res, 200, {
        ok: false,
        code: "search-unavailable",
        message: `Provider "${requested}" needs an API key / engine host; keyless ddg is available.`,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }

    try {
      const search =
        options.search ??
        createDuckDuckGoSearch(
          typeof settings.lang === "string" && settings.lang.startsWith("zh")
            ? { region: "wt-wt" }
            : {},
        );
      const result = await search.search({ query, maxResults });
      sendJson(res, 200, {
        ok: true,
        value: {
          provider: requested === "duckduckgo" ? "ddg" : requested,
          sources: result.sources.map((s) => ({
            url: s.url,
            ...(s.title ? { title: s.title } : {}),
            ...(s.snippet ? { snippet: s.snippet } : {}),
            ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
          })),
          content: result.content ?? "",
        },
        adapter: DSH_COMPAT_ADAPTER,
      });
    } catch (err) {
      sendJson(res, 200, {
        ok: false,
        code: "engine-failed",
        message: err instanceof Error ? err.message : String(err),
        adapter: DSH_COMPAT_ADAPTER,
      });
    }
    return true;
  }

  if (rel === "/check-update") {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ok: true,
      updateAvailable: false,
      current: null,
      latest: null,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  sendJson(res, 200, describeBody(xrkHome));
  return true;
}
