/**
 * Public HTTP claim handler shape (local type; not coupled to server-http root).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type PublicRouteHandlerFn = (
  req: IncomingMessage,
  res: ServerResponse,
) => boolean | Promise<boolean>;
