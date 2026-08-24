/**
 * Generic `/_dsh/<plugin>/…` HTTP surface (not a per-plugin list).
 * Mounted once via `dsh-path-capabilities` as `xrk-dsh-http`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

function pluginIdFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  // /_dsh/<plugin>/…
  return parts[1] ?? "unknown";
}

function tailFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts.slice(2).join("/") || "status";
}

/**
 * Honest JSON for community plugins that call `/_dsh/<pkg>/status` etc.
 * Cordis Host process is not embedded — panels get shape, not SPA HTML.
 */
export async function handleGenericDshHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith("/_dsh/")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await readBody(req);
  }

  const plugin = pluginIdFromPath(pathname);
  const tail = tailFromPath(pathname);
  const incomplete = ["dsh-host"] as const;

  if (
    tail === "status" ||
    tail === "health" ||
    tail === "" ||
    tail === "ping"
  ) {
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
          writable: false,
          note: "XRK generic _dsh HTTP; Cordis Host apply() not embedded.",
        },
        [...incomplete],
      ),
    );
    return true;
  }

  if (tail === "config" || tail === "settings" || tail.endsWith("/config")) {
    sendJson(res, 200, {
      ok: true,
      plugin,
      path: pathname,
      config: {},
      adapter: DSH_COMPAT_ADAPTER,
      incomplete: [...incomplete],
    });
    return true;
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
        adapter: DSH_COMPAT_ADAPTER,
      },
      [...incomplete],
    ),
  );
  return true;
}
