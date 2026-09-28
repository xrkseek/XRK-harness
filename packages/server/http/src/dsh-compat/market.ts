/**
 * DSH `/dsh-market/*` and `/api/dsh-market` → XRK plugin inventory + catalog.
 *
 * Install / update / uninstall call `xrkh plugin add|remove` via `runPluginMutate`
 * (same path as Settings → Plugins). Set `XRK_MARKET_MUTATE_NPM=0` to restrict
 * mutations to local/file/link specs only.
 *
 * dshmarket Discover posts `{ url: <github https>, version? }` — never `npm`.
 * Awesome catalog pairs that `url` with an `npm` field; we resolve npm first so
 * already-adapted scoped packages (`@liustack/modlens`, …) install like Settings.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { sendJson } from "./underlying/http-json.js";
import {
  fetchXrkPluginCatalog,
  readXrkDisabledPluginIds,
  readXrkPluginInventory,
  type XrkPluginServicesOptions,
} from "../xrk/plugin-services.js";
import { runPluginMutate } from "../xrk/plugin-mutate.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";
import { parseJsonBody } from "./underlying/http-kit.js";

/** True for filesystem / file: / link: specs — not scoped npm `@scope/name`. */
export function isLocalPluginSpec(spec: string): boolean {
  const s = spec.trim();
  if (!s) return false;
  if (s.startsWith(".") || path.isAbsolute(s)) return true;
  if (s.startsWith("file:") || s.startsWith("link:")) return true;
  // Scoped npm `@scope/name` contains `/` but is not a filesystem path.
  if (/^@[^/]+\/[^@]+(?:@.+)?$/.test(s)) return false;
  return /[/\\]/.test(s);
}

/** When false (`XRK_MARKET_MUTATE_NPM=0`), only local/file/link specs mutate. */
export function allowRemoteNpmMutate(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.XRK_MARKET_MUTATE_NPM !== "0";
}

function canMutateSpec(spec: string): boolean {
  if (!spec.trim()) return false;
  if (allowRemoteNpmMutate()) return true;
  return isLocalPluginSpec(spec);
}

function alreadyVersionPinned(spec: string): boolean {
  const s = spec.trim();
  if (s.startsWith("@")) {
    const rest = s.slice(1);
    const slash = rest.indexOf("/");
    if (slash < 0) return false;
    return rest.slice(slash + 1).includes("@");
  }
  return s.includes("@");
}

/** `https://github.com/org/repo[/tree/branch/sub/path]` → `github:…` CLI spec. */
export function githubHttpsToPluginSpec(url: string): string | undefined {
  const m =
    /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)\/(.*))?\/?(?:[?#].*)?$/i.exec(
      url.trim(),
    );
  if (!m) return undefined;
  const org = m[1]!;
  const repo = m[2]!;
  const branch = m[3];
  const subpath = m[4]?.replace(/\/$/, "");
  if (subpath && branch) {
    return `github:${org}/${repo}#${branch}&path:/${subpath}`;
  }
  if (branch) return `github:${org}/${repo}#${branch}`;
  return `github:${org}/${repo}`;
}

export interface MarketCatalogHint {
  readonly npmByUrl: ReadonlyMap<string, string>;
  readonly npmByName: ReadonlyMap<string, string>;
}

/** Build url/name → npm maps from awesome-dsh catalog JSON. */
export function buildMarketCatalogHint(catalog: unknown): MarketCatalogHint {
  const npmByUrl = new Map<string, string>();
  const npmByName = new Map<string, string>();
  const plugins =
    catalog &&
    typeof catalog === "object" &&
    Array.isArray((catalog as { plugins?: unknown }).plugins)
      ? ((catalog as { plugins: unknown[] }).plugins)
      : [];
  for (const row of plugins) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const npm =
      typeof r.npm === "string" && r.npm.trim() ? r.npm.trim() : "";
    if (!npm) continue;
    const name =
      typeof r.name === "string" && r.name.trim() ? r.name.trim() : "";
    const url =
      typeof r.url === "string" && r.url.trim() ? r.url.trim() : "";
    if (name) {
      npmByName.set(name, npm);
      npmByName.set(name.toLowerCase(), npm);
    }
    npmByName.set(npm, npm);
    npmByName.set(npm.toLowerCase(), npm);
    if (url) {
      npmByUrl.set(url, npm);
      npmByUrl.set(url.replace(/\/$/, ""), npm);
    }
  }
  return { npmByUrl, npmByName };
}

function pinVersion(spec: string, version: string): string {
  const s = spec.trim();
  const v = version.trim();
  if (!s || !v || alreadyVersionPinned(s)) return s;
  if (
    isLocalPluginSpec(s) ||
    s.startsWith("github:") ||
    s.startsWith("git+") ||
    /^https?:\/\//i.test(s)
  ) {
    return s;
  }
  return `${s}@${v}`;
}

/**
 * Resolve dshmarket body → CLI install/remove spec.
 *
 * Preference: `spec` / `npm` / `package` → catalog npm for github `url` →
 * `github:` rewrite → `name` / `id`. Optional `version` pins npm names only.
 */
export function resolveMarketPluginSpec(
  body: Record<string, unknown>,
  catalogHint?: MarketCatalogHint,
): string {
  const specField =
    typeof body.spec === "string" ? body.spec.trim() : "";
  const npmField =
    (typeof body.npm === "string" && body.npm.trim()) ||
    (typeof body.package === "string" && body.package.trim()) ||
    "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const version =
    typeof body.version === "string" ? body.version.trim() : "";

  let raw = "";
  if (specField) {
    raw = specField;
  } else if (npmField) {
    raw = npmField;
  } else if (url) {
    const mapped =
      catalogHint?.npmByUrl.get(url) ||
      catalogHint?.npmByUrl.get(url.replace(/\/$/, "")) ||
      (name
        ? catalogHint?.npmByName.get(name) ||
          catalogHint?.npmByName.get(name.toLowerCase())
        : undefined);
    if (mapped) {
      raw = mapped;
    } else {
      raw = githubHttpsToPluginSpec(url) || url;
    }
  } else if (name) {
    raw =
      catalogHint?.npmByName.get(name) ||
      catalogHint?.npmByName.get(name.toLowerCase()) ||
      name;
  } else if (id) {
    raw =
      catalogHint?.npmByName.get(id) ||
      catalogHint?.npmByName.get(id.toLowerCase()) ||
      id;
  }

  return pinVersion(raw, version);
}

async function loadCatalogHint(): Promise<MarketCatalogHint | undefined> {
  try {
    const { catalog } = await fetchXrkPluginCatalog();
    return buildMarketCatalogHint(catalog);
  } catch {
    return undefined;
  }
}

function isMutateAction(action: string, pathname: string): boolean {
  return (
    action === "install" ||
    action === "add" ||
    action === "uninstall" ||
    action === "remove" ||
    action === "update" ||
    action === "upgrade" ||
    pathname.includes("/install") ||
    pathname.includes("/uninstall") ||
    pathname.includes("/update") ||
    pathname.includes("/upgrade")
  );
}

function isRemoveAction(action: string, pathname: string): boolean {
  return (
    action === "uninstall" ||
    action === "remove" ||
    pathname.includes("uninstall")
  );
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
      note: "Install/update/uninstall: xrkh plugin add|remove via runPluginMutate (catalog url→npm).",
      npmMutate: allowRemoteNpmMutate(),
    }));
    return;
  }

  if (pathname === "/dsh-market/installed" && method === "GET") {
    const inv = readXrkPluginInventory(options);
    const disabled = readXrkDisabledPluginIds(options);
    sendJson(res, 200, tag({
      installed: inv.installedMap,
      present: inv.present,
      disabled,
      live: [],
      repoIdentities: {},
      repoHints: {},
      via: "/xrk/plugins/inventory",
    }));
    return;
  }

  if (pathname === "/dsh-market/updates" && method === "GET") {
    // dshmarket reads `body.updates` as a name → row map (`updateAvailable`, `latest`).
    // Offline probe: empty map (no false upgrade badges). POST update still re-adds.
    sendJson(res, 200, tag({ updates: {} }));
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
      note: "Market maintenance actions stay CLI-deferred on XRK.",
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
      action === "cancel" ||
      action === "restart" ||
      action === "backup" ||
      action === "restore" ||
      action === "channel" ||
      action === "approve-builds"
    ) {
      sendJson(res, 200, {
        ok: false,
        accepted: false,
        deferred: true,
        action,
        adapter: DSH_COMPAT_ADAPTER,
        incomplete: ["market-host"],
        note: "Market maintenance actions stay CLI-deferred on XRK.",
      });
      return;
    }

    if (isMutateAction(action, pathname)) {
      const needsCatalog =
        typeof body.url === "string" ||
        (typeof body.name === "string" &&
          !body.spec &&
          !body.npm &&
          !body.package);
      const hint = needsCatalog ? await loadCatalogHint() : undefined;
      const spec = resolveMarketPluginSpec(body, hint);
      const remove = isRemoveAction(action, pathname);
      const pluginsDir =
        options.pluginsDir?.trim() ||
        readXrkPluginInventory(options).pluginsDir;
      const mutateAction = remove ? "remove" : "add";
      let mutate: Awaited<ReturnType<typeof runPluginMutate>> | undefined;
      let skippedReason: string | undefined;
      if (!spec) {
        skippedReason = "missing plugin spec (name / url / package)";
      } else if (!pluginsDir) {
        skippedReason = "pluginsDir unavailable";
      } else if (!canMutateSpec(spec)) {
        skippedReason =
          "remote/npm mutate disabled (XRK_MARKET_MUTATE_NPM=0)";
      } else {
        mutate = await runPluginMutate({
          action: mutateAction,
          spec,
          pluginsDir,
        });
      }
      const inv = readXrkPluginInventory({ ...options, pluginsDir });
      const accepted = mutate?.ok === true;
      const attempted = mutate !== undefined;
      sendJson(res, 200, {
        ok: accepted,
        accepted,
        deferred: !attempted,
        adapter: DSH_COMPAT_ADAPTER,
        action: remove
          ? "uninstall"
          : action === "update" || action === "upgrade"
            ? "update"
            : "install",
        spec,
        via: "/xrk/plugins/inventory",
        installed: inv.present,
        ...(accepted
          ? { mutated: true, restartRequired: true }
          : {
              cli: spec
                ? `xrkh plugin ${mutateAction} ${spec}`
                : `xrkh plugin ${mutateAction} <spec>`,
              error: mutate?.error ?? skippedReason,
              ...(mutate?.stderr ? { stderr: mutate.stderr } : {}),
              ...(mutate?.stdout ? { stdout: mutate.stdout } : {}),
              ...(!attempted
                ? {
                    incomplete: ["market-host"],
                    note: skippedReason,
                  }
                : {
                    note:
                      "xrkh plugin mutate failed; see error/stderr. Restart Host after a successful install.",
                  }),
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
    note: "Use POST install/update/uninstall or GET installed/registry.",
  });
}
