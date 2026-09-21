/**
 * Wire `kind: host` process plugins into the HTTP public chain (before SPA).
 * Mirrors DSH `ctx.webServer.register` without Cordis `apply()`.
 */
import type { RegisteredPlugin } from "@xrkseek/server-loader";
import { listHostPlugins } from "@xrkseek/server-loader";
import type { HostWireContext } from "@xrkseek/server-loader";
import { chainPublicHandlers, type PublicRouteHandlerFn } from "./public-routes.js";

export type { HostWireContext } from "@xrkseek/server-loader";

/**
 * Chain all host plugin public handlers (discover order).
 * Returns a no-op handler when no host plugins are registered.
 */
export function createHostPluginsPublicHandler(
  plugins: readonly RegisteredPlugin[],
  ctx: HostWireContext,
): PublicRouteHandlerFn {
  const hostPlugins = listHostPlugins(plugins);
  if (hostPlugins.length === 0) {
    return async () => false;
  }
  const handlers = hostPlugins.map((plugin) => plugin.createPublicHandler!(ctx));
  return chainPublicHandlers(...handlers);
}

/**
 * Rebuild the host-plugin chain when the live registry changes so unload
 * pairs with register without `xrkh restart`. `createPublicHandler` runs
 * again only when the id set changes.
 */
export function createLiveHostPluginsPublicHandler(
  list: () => readonly RegisteredPlugin[],
  ctx: HostWireContext,
): PublicRouteHandlerFn {
  let key = "";
  let inner: PublicRouteHandlerFn = async () => false;
  return async (req, res) => {
    const plugins = listHostPlugins(list());
    const nextKey = plugins.map((plugin) => plugin.id).join("\n");
    if (nextKey !== key) {
      key = nextKey;
      inner = createHostPluginsPublicHandler(plugins, ctx);
    }
    return inner(req, res);
  };
}
