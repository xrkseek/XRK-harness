/**
 * Native Host sidebar surface (`/sidebar/*`).
 *
 * Product contract for `xrkh-better-sidebar` (kind: client). Mounted by Host
 * as a first-class public handler — not via dsh-compat capability table.
 * Community clients that also call `/sidebar/*` share this same Host surface.
 */
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
  SidebarChangesWireEvent,
} from "./sidebar-face-bridge.js";
export type { SidebarHostOptions, SidebarAgentRegistries } from "./sidebar-adapter.js";
export { handleSidebarHost } from "./sidebar-adapter.js";
export { decodeSidebarHtmlPath } from "./sidebar-html.js";
export { mediaTypeForPath } from "./sidebar-media-type.js";
export {
  OfficeToPdfError,
  createSofficeOfficeToPdfProvider,
  officePreviewExtension,
  type OfficeToPdfProvider,
  type OfficeToPdfRequest,
  type OfficeToPdfResult,
} from "./office-to-pdf.js";
export { gitStatus } from "./sidebar-git.js";
export {
  handleBundleChunkStub,
  DEFAULT_SIDEBAR_EXPORTS,
} from "./bundle-chunk-stub.js";
export {
  loadSidebarPrefs,
  saveSidebarPrefs,
  patchSidebarPrefs,
  SIDEBAR_PREFS_DEFAULT,
} from "./sidebar-prefs-store.js";
export {
  enforceSidebarPolicy,
  sidebarPolicyDenied,
  type SidebarPolicyAskResolver,
  type SidebarPolicyFailure,
} from "./sidebar-policy.js";

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
