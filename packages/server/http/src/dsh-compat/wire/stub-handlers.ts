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
import {
  patchPluginSurface,
  readPluginSurface,
} from "../underlying/plugin-surface-store.js";

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

export interface StubRpcOptions {
  readonly xrkHome?: string;
  /** RPC channel name (e.g. `/dsh-foo`) used as surface id. */
  readonly channel?: string;
}

function surfaceId(channel: string | undefined, feature: string): string {
  const raw = (channel ?? feature).replace(/^\//, "").trim();
  return raw || feature || "plugin";
}

function extractWritePatch(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (
    payload.value &&
    typeof payload.value === "object" &&
    !Array.isArray(payload.value)
  ) {
    return payload.value as Record<string, unknown>;
  }
  if (
    payload.document &&
    typeof payload.document === "object" &&
    !Array.isArray(payload.document)
  ) {
    return payload.document as Record<string, unknown>;
  }
  const {
    action: _a,
    expectedRevision: _e,
    ops: _o,
    ...rest
  } = payload;
  return rest;
}

export function stubRpcHandler(
  kind: string,
  endpoint: string,
  payload: Record<string, unknown>,
  feature = "plugin",
  options: StubRpcOptions = {},
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
    const id = surfaceId(options.channel, feature);
    const xrkHome = options.xrkHome;
    if (
      endpoint === "get" ||
      endpoint === "describe" ||
      endpoint === "status" ||
      endpoint === "status-summary" ||
      endpoint === "view" ||
      endpoint === ""
    ) {
      const surface = readPluginSurface(xrkHome, id);
      return honestReady({
        value: surface.settings,
        settings: surface.settings,
        config: surface.config,
        state: surface.state,
        revision: surface.revision,
        writable: true,
        feature,
        channel: options.channel,
      });
    }
    if (
      endpoint === "set" ||
      endpoint === "apply" ||
      endpoint === "patch" ||
      endpoint === "mutate" ||
      endpoint === "save"
    ) {
      const patch = extractWritePatch(payload);
      const ops = Array.isArray(payload.ops) ? payload.ops : [];
      const fromOps: Record<string, unknown> = {};
      for (const raw of ops) {
        if (!raw || typeof raw !== "object") continue;
        const op = raw as Record<string, unknown>;
        const path = Array.isArray(op.path)
          ? (op.path as unknown[]).map(String)
          : [];
        if (
          (op.op === "set" || op.value !== undefined) &&
          path.length === 1 &&
          path[0]
        ) {
          fromOps[path[0]] = op.value;
        }
      }
      const merged = { ...fromOps, ...patch };
      const next =
        Object.keys(merged).length > 0
          ? patchPluginSurface(xrkHome, id, "settings", merged, "merge")
          : readPluginSurface(xrkHome, id);
      return honestReady({
        ok: true,
        value: next.settings,
        settings: next.settings,
        revision: next.revision,
        writable: true,
        feature,
        channel: options.channel,
        persisted: Object.keys(merged).length > 0,
      });
    }
    return hostIncomplete(feature, {
      ok: false,
      code: "STUB_ENDPOINT",
      endpoint,
      message: "No underlying provider for this channel endpoint.",
    });
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

export function stubHttpProvider(
  route: PluginHostHttpRoute,
): HostProviderPartial {
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
