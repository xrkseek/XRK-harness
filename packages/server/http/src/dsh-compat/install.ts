/**
 * `/api/install` — web-all / market install entry → `runPluginMutate`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { runPluginMutate } from "../xrk/plugin-mutate.js";
import { readXrkPluginInventory } from "../xrk/plugin-services.js";

export interface InstallHttpOptions {
  readonly xrkHome?: string;
  readonly pluginsDir?: string;
}

export function isInstallPath(pathname: string): boolean {
  return pathname === "/api/install" || pathname.startsWith("/api/install/");
}

function resolveSpec(body: Record<string, unknown>): string | undefined {
  for (const key of ["spec", "npm", "package", "name", "id", "pkg"]) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof body.url === "string" && body.url.trim()) return body.url.trim();
  return undefined;
}

export async function handleInstallHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: InstallHttpOptions = {},
): Promise<boolean> {
  if (!isInstallPath(pathname)) return false;
  const method = httpMethod(req);

  if (method === "GET" || method === "HEAD") {
    const inv = readXrkPluginInventory(options);
    sendJson(res, 200, {
      ok: true,
      installed: inv.present,
      pluginsDir: inv.pluginsDir ?? options.pluginsDir ?? null,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (method !== "POST" && method !== "PUT") {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return true;
  }

  const body = await parseJsonBody(req);
  const actionRaw =
    typeof body.action === "string" ? body.action.toLowerCase() : "install";
  const remove =
    actionRaw === "uninstall" ||
    actionRaw === "remove" ||
    pathname.endsWith("/uninstall");
  const spec = resolveSpec(body);
  const pluginsDir =
    options.pluginsDir?.trim() ||
    readXrkPluginInventory(options).pluginsDir;

  if (!spec) {
    sendJson(res, 200, {
      ok: false,
      error: "missing plugin spec (name / npm / package / url)",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }
  if (!pluginsDir) {
    sendJson(res, 200, {
      ok: false,
      error: "pluginsDir unavailable",
      cli: `xrkh plugin ${remove ? "remove" : "add"} ${spec}`,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  const mutate = await runPluginMutate({
    action: remove ? "remove" : "add",
    spec,
    pluginsDir,
  });
  sendJson(res, 200, {
    ok: mutate.ok,
    accepted: mutate.ok,
    action: remove ? "uninstall" : "install",
    spec,
    restartRequired: mutate.ok,
    ...(mutate.ok
      ? { mutated: true }
      : {
          error: mutate.error ?? "plugin mutate failed",
          ...(mutate.stderr ? { stderr: mutate.stderr } : {}),
          ...(mutate.stdout ? { stdout: mutate.stdout } : {}),
          cli: `xrkh plugin ${remove ? "remove" : "add"} ${spec}`,
        }),
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
