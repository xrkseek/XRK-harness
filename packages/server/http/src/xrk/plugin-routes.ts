/**
 * XRK-native public plugin routes (底层).
 *
 * | Path | Capability |
 * |------|------------|
 * | `GET /xrk/plugins/inventory` | CLI-installed user plugins |
 * | `GET /xrk/plugins/catalog` | Community catalog (awesome) |
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http-json.js";
import {
  createPublicRouteHandler,
  type PublicRoute,
  type PublicRouteHandlerFn,
} from "../public-routes.js";
import {
  fetchXrkPluginCatalog,
  readXrkPluginInventory,
  type XrkPluginServicesOptions,
} from "./plugin-services.js";

export function createXrkPluginRoutes(
  options: XrkPluginServicesOptions = {},
): readonly PublicRoute[] {
  return [
    {
      prefix: "/xrk/plugins/inventory",
      methods: ["GET", "HEAD"],
      handle: async (_req, res) => {
        const inv = readXrkPluginInventory(options);
        sendJson(res, 200, {
          ok: true,
          pluginsDir: inv.pluginsDir,
          packages: inv.packages,
          present: inv.present,
        });
      },
    },
    {
      prefix: "/xrk/plugins/catalog",
      methods: ["GET", "HEAD"],
      handle: async (_req, res) => {
        try {
          const { catalog, source, cached } = await fetchXrkPluginCatalog();
          sendJson(res, 200, {
            ok: true,
            catalog,
            source,
            cached,
          });
        } catch (err) {
          sendJson(res, 502, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
}

export function createXrkPluginPublicHandler(
  options: XrkPluginServicesOptions = {},
): PublicRouteHandlerFn {
  return createPublicRouteHandler(createXrkPluginRoutes(options));
}

/** @deprecated use createXrkPluginPublicHandler — kept for call-site clarity */
export function handleXrkPluginRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: XrkPluginServicesOptions = {},
): Promise<boolean> {
  return Promise.resolve(createXrkPluginPublicHandler(options)(req, res));
}
