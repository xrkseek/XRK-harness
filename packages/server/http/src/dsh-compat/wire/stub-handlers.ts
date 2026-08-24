/**
 * Honest stub RPC/HTTP when no named underlying capability matches.
 */
import type { IncomingMessage } from "node:http";
import { readBody, sendJson } from "../underlying/http-json.js";
import type {
  DshHttpRoute,
  HostProviderPartial,
  PluginHostHttpRoute,
} from "../adapter-types.js";
import {
  honestHostActionUnavailable,
  honestReady,
} from "../honest-envelope.js";
import { hostIncomplete, tag } from "../meta.js";

export const EMPTY_PRESET_CATALOG = Object.freeze({
  defaultId: "",
  items: Object.freeze([]),
});

export function imOfflineSnapshot(): Record<string, unknown> {
  return tag(
    {
      schemaVersion: 1,
      revision: 0,
      state: "offline",
      bots: [],
      totals: { configured: 0, connected: 0 },
      provisioning: null,
      testMessage: null,
      agentPresetCatalog: { ...EMPTY_PRESET_CATALOG, items: [] },
      connected: false,
      configured: false,
      bot: null,
      health: { state: "offline" },
      note: "IM bridge requires Cordis Host; XRK returns an empty offline snapshot.",
    },
    ["im-host"],
  );
}

export function stubRpcHandler(
  kind: string,
  endpoint: string,
  _payload: Record<string, unknown>,
  _feature = "plugin",
): unknown {
  if (kind === "im-offline") {
    if (
      endpoint === "connection.status" ||
      endpoint === "status" ||
      endpoint === ""
    ) {
      return imOfflineSnapshot();
    }
    return honestHostActionUnavailable("im", endpoint);
  }
  if (kind === "generic") {
    if (
      endpoint === "get" ||
      endpoint === "describe" ||
      endpoint === "status" ||
      endpoint === "status-summary" ||
      endpoint === ""
    ) {
      return honestReady({ value: {} });
    }
    if (endpoint === "set" || endpoint === "apply" || endpoint === "patch") {
      return honestReady();
    }
    return honestReady({ endpoint });
  }
  return { ok: false, endpoint, kind, adapter: "xrk-dsh-compat" };
}

async function drain(req: IncomingMessage, method: string): Promise<void> {
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await readBody(req);
  }
}

function prefixMatcher(prefix: string): (pathname: string) => boolean {
  const norm = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return (p) => p === prefix || p.startsWith(norm);
}

export function stubHttpProvider(route: PluginHostHttpRoute): HostProviderPartial {
  const feature =
    typeof route.options?.feature === "string"
      ? route.options.feature
      : "plugin";
  const routes = Array.isArray(route.options?.routes)
    ? (route.options.routes as Array<Record<string, unknown>>)
    : [];
  const status501 = route.options?.status501 === true;
  const incompleteTag =
    typeof route.options?.incompleteTag === "string"
      ? route.options.incompleteTag
      : undefined;

  const http: DshHttpRoute[] = [
    {
      match: prefixMatcher(route.prefix),
      handle: async (req, res, pathname) => {
        await drain(req, (req.method ?? "GET").toUpperCase());
        for (const row of routes) {
          const p = row.path;
          if (typeof p !== "string") continue;
          const exact = row.exact === true;
          const isPrefix = row.prefix === true;
          const match =
            (exact && pathname === p) ||
            (isPrefix && (pathname === p || pathname.startsWith(`${p}/`)));
          if (!match) continue;
          const body = (row.body as Record<string, unknown>) ?? {};
          const incomplete = row.incomplete as string[] | undefined;
          const status =
            typeof row.status === "number" ? row.status : status501 ? 501 : 200;
          sendJson(
            res,
            status,
            incomplete?.length
              ? tag({ ...body, path: pathname }, incomplete)
              : typeof row.feature === "string"
                ? hostIncomplete(row.feature, { ...body, path: pathname })
                : { ...body, path: pathname },
          );
          return true;
        }
        sendJson(
          res,
          status501 ? 501 : 200,
          incompleteTag
            ? tag({ ok: true, path: pathname }, [incompleteTag])
            : honestReady({ path: pathname, feature }),
        );
        return true;
      },
    },
  ];
  return { http };
}
