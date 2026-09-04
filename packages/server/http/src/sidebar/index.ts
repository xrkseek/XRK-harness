/**
 * Native Host sidebar surface (`/sidebar/*`).
 *
 * Product contract for `xrkh-better-sidebar` (kind: client). Mounted by Host
 * as a first-class public handler — not via dsh-compat capability table.
 * Community clients that also call `/sidebar/*` share this same Host surface.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PublicRouteHandlerFn } from "../public-routes.js";
import {
  handleBundleChunkStub,
  DEFAULT_SIDEBAR_EXPORTS,
} from "./bundle-chunk-stub.js";
import {
  handleSidebarHost,
  type SidebarHostOptions,
} from "./sidebar-adapter.js";

export type {
  SidebarFaceBridge,
  SidebarSubagentLiveActivity,
} from "./sidebar-face-bridge.js";
export type { SidebarHostOptions, SidebarCompatOptions } from "./sidebar-adapter.js";
export {
  handleSidebarHost,
  handleSidebarCompat,
} from "./sidebar-adapter.js";
export { decodeSidebarHtmlPath } from "./sidebar-html.js";
export { gitStatus } from "./sidebar-git.js";
export {
  handleBundleChunkStub,
  DEFAULT_SIDEBAR_EXPORTS,
} from "./bundle-chunk-stub.js";

/**
 * Claim `/sidebar/*` before SPA static and before dsh-compat catch-alls.
 */
export function createSidebarPublicHandler(
  options: SidebarHostOptions = {},
): PublicRouteHandlerFn {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    if (!pathname.startsWith("/sidebar/")) return false;

    if (pathname.startsWith("/sidebar/bundle/")) {
      return handleBundleChunkStub(req, res, pathname, {
        urlPrefix: "/sidebar/bundle",
        exportsByChunk: DEFAULT_SIDEBAR_EXPORTS,
        registryGlobal: "__xrkhChunks__",
        ...(options.pluginsDir ? { pluginsDir: options.pluginsDir } : {}),
      });
    }

    return handleSidebarHost(req, res, pathname, options);
  };
}
