/**
 * Generic `/_dsh/<plugin>/…` HTTP surface (not a per-plugin list).
 * Mounted once via `dsh-path-capabilities` as `xrk-dsh-http`.
 * Settings / config / state persist under ~/.xrk/community-surfaces/<plugin>/.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import {
  httpMethod,
  isMutatingMethod,
  parseJsonBody,
} from "./underlying/http-kit.js";
import {
  patchPluginSurface,
  readPluginSurface,
  type PluginSurfaceBucket,
} from "./underlying/plugin-surface-store.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

export interface GenericDshHttpOptions {
  readonly xrkHome?: string;
}

function pluginIdFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  // /_dsh/<plugin>/…
  return parts[1] ?? "unknown";
}

function tailFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts.slice(2).join("/") || "status";
}

function bucketOf(tail: string): PluginSurfaceBucket | undefined {
  if (tail === "settings" || tail.endsWith("/settings")) return "settings";
  if (tail === "config" || tail.endsWith("/config")) return "config";
  if (
    tail === "state" ||
    tail.endsWith("/state") ||
    tail === "workstate" ||
    tail.endsWith("/workstate")
  ) {
    return "state";
  }
  return undefined;
}

function extractPatch(
  body: Record<string, unknown>,
): { patch: Record<string, unknown>; mode: "merge" | "replace" } {
  if (body.value && typeof body.value === "object" && !Array.isArray(body.value)) {
    return {
      patch: body.value as Record<string, unknown>,
      mode: "replace",
    };
  }
  if (
    body.document &&
    typeof body.document === "object" &&
    !Array.isArray(body.document)
  ) {
    return {
      patch: body.document as Record<string, unknown>,
      mode: "replace",
    };
  }
  if (body.config && typeof body.config === "object" && !Array.isArray(body.config)) {
    return {
      patch: body.config as Record<string, unknown>,
      mode: "merge",
    };
  }
  if (body.state && typeof body.state === "object" && !Array.isArray(body.state)) {
    return {
      patch: body.state as Record<string, unknown>,
      mode: "merge",
    };
  }
  const {
    action: _a,
    expectedRevision: _e,
    ...rest
  } = body;
  return { patch: rest, mode: "merge" };
}

/**
 * Honest JSON for community plugins that call `/_dsh/<pkg>/status` etc.
 * Cordis Host process is not embedded — panels get shape + local persist.
 */
export async function handleGenericDshHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: GenericDshHttpOptions = {},
): Promise<boolean> {
  if (!pathname.startsWith("/_dsh/")) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const plugin = pluginIdFromPath(pathname);
  const tail = tailFromPath(pathname);
  const surface = readPluginSurface(xrkHome, plugin);
  const bucket = bucketOf(tail);

  if (
    tail === "status" ||
    tail === "health" ||
    tail === "" ||
    tail === "ping"
  ) {
    if (isMutatingMethod(method)) await parseJsonBody(req).catch(() => ({}));
    sendJson(
      res,
      200,
      tag(
        {
          ok: true,
          status: "ready",
          plugin,
          path: pathname,
          adapter: DSH_COMPAT_ADAPTER,
          writable: true,
          revision: surface.revision,
          note: "XRK generic _dsh HTTP; Cordis Host apply() not embedded.",
        },
        ["dsh-host"],
      ),
    );
    return true;
  }

  if (bucket) {
    if (isMutatingMethod(method)) {
      const body = await parseJsonBody(req);
      const { patch, mode } = extractPatch(body);
      const next =
        Object.keys(patch).length > 0
          ? patchPluginSurface(xrkHome, plugin, bucket, patch, mode)
          : readPluginSurface(xrkHome, plugin);
      const value = next[bucket];
      sendJson(res, 200, {
        ok: true,
        plugin,
        path: pathname,
        [bucket]: value,
        value,
        config: next.config,
        state: next.state,
        settings: next.settings,
        revision: next.revision,
        writable: true,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      plugin,
      path: pathname,
      [bucket]: surface[bucket],
      value: surface[bucket],
      config: surface.config,
      state: surface.state,
      settings: surface.settings,
      revision: surface.revision,
      writable: true,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (isMutatingMethod(method)) {
    await parseJsonBody(req).catch(() => ({}));
  }

  sendJson(
    res,
    200,
    tag(
      {
        ok: true,
        plugin,
        path: pathname,
        endpoint: tail,
        revision: surface.revision,
        adapter: DSH_COMPAT_ADAPTER,
      },
      ["dsh-host"],
    ),
  );
  return true;
}
