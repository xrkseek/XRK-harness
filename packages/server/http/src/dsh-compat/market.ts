/**
 * DSH `/dsh-market/*` and `/api/dsh-market` → XRK plugin inventory + catalog.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { sendJson } from "../http-json.js";
import {
  fetchXrkPluginCatalog,
  readXrkPluginInventory,
  type XrkPluginServicesOptions,
} from "../xrk/plugin-services.js";
import { runPluginMutate } from "../xrk/plugin-mutate.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";
import { parseJsonBody } from "./underlying/http-kit.js";

function isLocalPluginSpec(spec: string): boolean {
  const s = spec.trim();
  if (!s) return false;
  if (process.env.XRK_MARKET_MUTATE_NPM === "1") return true;
  if (s.startsWith(".") || path.isAbsolute(s)) return true;
  if (s.startsWith("file:") || s.startsWith("link:")) return true;
  return /[/\\]/.test(s);
}

export async function handleDshMarketHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: XrkPluginServicesOptions,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/dsh-market/registry" && method === "GET") {
    try {
      const { catalog, source } = await fetchXrkPluginCatalog();
      sendJson(res, 200, tag({
        registry: catalog,
        source,
        via: "/xrk/plugins/catalog",
      }));
    } catch (err) {
      sendJson(res, 502, tag({
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    return;
  }

  if (pathname === "/dsh-market/status" && method === "GET") {
    sendJson(res, 200, tag({
      pnpm: true,
      boot: `${DSH_COMPAT_ADAPTER}-${Date.now()}`,
      host: "xrk-harness",
      note: "Install/uninstall: xrk-harness plugin add|remove (maps to XRK inventory).",
    }));
    return;
  }

  if (pathname === "/dsh-market/installed" && method === "GET") {
    const inv = readXrkPluginInventory(options);
    sendJson(res, 200, tag({
      installed: inv.installedMap,
      present: inv.present,
      disabled: [],
      live: [],
      repoIdentities: {},
      repoHints: {},
      via: "/xrk/plugins/inventory",
    }));
    return;
  }

  if (pathname === "/dsh-market/updates" && method === "GET") {
    sendJson(res, 200, tag({ updates: [] }));
    return;
  }

  if (pathname === "/dsh-market/logs" && method === "GET") {
    sendJson(res, 200, tag({ lines: [] }));
    return;
  }

  if (pathname === "/dsh-market/check" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      issues: [],
      adapter: DSH_COMPAT_ADAPTER,
      host: "xrk-harness",
    });
    return;
  }

  if (pathname === "/dsh-market/groups" && method === "GET") {
    sendJson(res, 200, tag({ groups: [] }));
    return;
  }

  if (
    (pathname === "/dsh-market/backup" ||
      pathname === "/dsh-market/restore" ||
      pathname === "/dsh-market/channel" ||
      pathname === "/dsh-market/restart" ||
      pathname === "/dsh-market/approve-builds" ||
      pathname === "/dsh-market/cancel") &&
    method === "GET"
  ) {
    sendJson(res, 200, tag({
      ok: true,
      path: pathname,
      adapter: DSH_COMPAT_ADAPTER,
      deferred: true,
      note: "Use xrk-harness plugin CLI for inventory mutations on XRK.",
    }));
    return;
  }

  if (
    (pathname === "/dsh-market/gist" ||
      pathname === "/dsh-market/webdav" ||
      pathname === "/dsh-market/bundle-order") &&
    method === "GET"
  ) {
    sendJson(res, 200, { items: [], path: pathname, adapter: DSH_COMPAT_ADAPTER });
    return;
  }

  if (method === "POST") {
    const body = await parseJsonBody(req);

    const rpcMethod = typeof body.method === "string" ? body.method : "";
    const action =
      rpcMethod ||
      (typeof body.action === "string" ? body.action : "") ||
      pathname.split("/").pop() ||
      "";

    if (rpcMethod === "list" || rpcMethod === "installed") {
      const inv = readXrkPluginInventory(options);
      let plugins: unknown[] = [];
      try {
        const fetched = await fetchXrkPluginCatalog();
        const catalog = fetched.catalog;
        if (
          catalog &&
          typeof catalog === "object" &&
          Array.isArray((catalog as { plugins?: unknown }).plugins)
        ) {
          plugins = (catalog as { plugins: unknown[] }).plugins;
        }
      } catch {
        plugins = [];
      }
      sendJson(res, 200, {
        ok: true,
        plugins: rpcMethod === "installed"
          ? inv.present.map((id) => ({ id, name: id, installed: true }))
          : plugins,
        cats: [],
        adapter: DSH_COMPAT_ADAPTER,
        via: "/xrk/plugins/inventory",
      });
      return;
    }

    if (
      action === "install" ||
      action === "add" ||
      action === "uninstall" ||
      action === "remove" ||
      action === "upgrade" ||
      action === "cancel" ||
      action === "restart" ||
      action === "backup" ||
      action === "restore" ||
      action === "channel" ||
      action === "approve-builds" ||
      pathname.includes("/install") ||
      pathname.includes("/uninstall")
    ) {
      if (
        action === "cancel" ||
        action === "restart" ||
        action === "backup" ||
        action === "restore" ||
        action === "channel" ||
        action === "approve-builds"
      ) {
        sendJson(res, 200, {
          ok: true,
          accepted: true,
          deferred: true,
          action,
          adapter: DSH_COMPAT_ADAPTER,
          note: "Market maintenance actions are CLI-deferred on XRK.",
        });
        return;
      }
      const spec =
        (typeof body.spec === "string" && body.spec) ||
        (typeof body.package === "string" && body.package) ||
        (typeof body.name === "string" && body.name) ||
        (typeof body.id === "string" && body.id) ||
        "";
      const remove =
        action === "uninstall" ||
        action === "remove" ||
        pathname.includes("uninstall");
      const pluginsDir =
        options.pluginsDir?.trim() ||
        readXrkPluginInventory(options).pluginsDir;
      const mutate =
        spec && pluginsDir && isLocalPluginSpec(spec)
          ? await runPluginMutate({
              action: remove ? "remove" : "add",
              spec,
              pluginsDir,
            })
          : undefined;
      const inv = readXrkPluginInventory({ ...options, pluginsDir });
      sendJson(res, 200, {
        ok: mutate?.ok ?? Boolean(spec),
        accepted: true,
        deferred: !mutate?.ok,
        adapter: DSH_COMPAT_ADAPTER,
        spec,
        via: "/xrk/plugins/inventory",
        installed: inv.present,
        ...(mutate?.ok
          ? { mutated: true, restartRequired: true }
          : {
              cli: spec
                ? `xrk-harness plugin ${remove ? "remove" : "add"} ${spec}`
                : `xrk-harness plugin ${remove ? "remove" : "add"} <spec>`,
              error: mutate?.error,
            }),
      });
      return;
    }

    sendJson(res, 200, {
      ok: false,
      accepted: false,
      path: pathname,
      request: body,
      adapter: DSH_COMPAT_ADAPTER,
      error: "unknown market action",
    });
    return;
  }

  sendJson(res, 200, {
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
    note: "Use POST install/remove or GET installed/registry.",
  });
}
