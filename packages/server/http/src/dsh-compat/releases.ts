/**
 * GitHub-style `/releases/latest` for community plugins that self-update.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { readXrkPluginInventory } from "../xrk/plugin-services.js";
import type { XrkPluginServicesOptions } from "../xrk/plugin-services.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export async function handleReleasesHttp(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: XrkPluginServicesOptions,
): Promise<boolean> {
  if (
    pathname !== "/releases/latest" &&
    pathname !== "/releases" &&
    pathname !== "/latest"
  ) {
    return false;
  }
  const inv = readXrkPluginInventory(options);
  const version =
    inv.installedMap["dsh-vision-router"]?.version ??
    inv.installedMap["vision-router"]?.version ??
    inv.installedMap["dsh-context"]?.version ??
    "0.0.0";
  if (pathname === "/releases") {
    sendJson(res, 200, {
      releases: [{ tag_name: version, name: version, adapter: DSH_COMPAT_ADAPTER }],
    });
    return true;
  }
  // `/latest` and `/releases/latest` — dsh-context / vision-router self-update probes.
  sendJson(res, 200, {
    tag_name: version,
    name: version,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}

export function isReleasesPath(pathname: string): boolean {
  return (
    pathname === "/releases/latest" ||
    pathname === "/releases" ||
    pathname === "/latest"
  );
}
