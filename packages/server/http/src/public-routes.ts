/**
 * Composable public HTTP route table (claimed before SPA static).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type PublicRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => void | Promise<void>;

export interface PublicRoute {
  /** Path prefix match (`/xrk/plugins` matches `/xrk/plugins/inventory`). */
  readonly prefix: string;
  readonly methods?: readonly string[];
  readonly handle: PublicRouteHandler;
}

export type PublicRouteHandlerFn = (
  req: IncomingMessage,
  res: ServerResponse,
) => boolean | Promise<boolean>;

/**
 * Build a `tryHandlePublic` hook from ordered routes (first match wins).
 */
export function createPublicRouteHandler(
  routes: readonly PublicRoute[],
): PublicRouteHandlerFn {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();
    for (const route of routes) {
      const path = url.pathname;
      if (path !== route.prefix && !path.startsWith(`${route.prefix}/`)) {
        continue;
      }
      if (
        route.methods &&
        route.methods.length > 0 &&
        !route.methods.includes(method)
      ) {
        continue;
      }
      await route.handle(req, res, url);
      return true;
    }
    return false;
  };
}

/** Chain multiple public handlers (first claim wins). */
export function chainPublicHandlers(
  ...handlers: readonly PublicRouteHandlerFn[]
): PublicRouteHandlerFn {
  return async (req, res) => {
    for (const h of handlers) {
      if (await h(req, res)) return true;
    }
    return false;
  };
}
