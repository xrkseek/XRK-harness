/**
 * XRK-native Host `apply(ctx)` shim — registers routes without Cordis kernel.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  CordisHttpHandler,
  CordisRpcHandler,
} from "./cordis-registry.js";
import type {
  DshAdapterContribution,
  DshCompatWireOptions,
  HostProviderPartial,
} from "./adapter-types.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { registerDshCompatUpgrade } from "./dsh-compat-upgrades.js";
import { registerHostApply } from "./host-apply-registry.js";

export interface XrkWebServerRoute {
  readonly kind?: string;
  readonly path: string;
  readonly methods?: readonly string[];
  readonly handler: (
    req: IncomingMessage,
    res: ServerResponse,
    pathname?: string,
  ) => void | Promise<void | boolean>;
}

export interface XrkWebServerUpgradeRoute {
  readonly path: string;
  readonly handler?: (
    req: IncomingMessage,
    socket: unknown,
    head: Buffer,
  ) => void;
}

export interface XrkHostApplyContext extends DshCompatWireOptions {
  readonly packageName: string;
  readonly pkgRoot: string;
  readonly paths: {
    readonly pkgRoot: string;
    readonly pluginsDir?: string;
    readonly xrkHome?: string;
    readonly workspaceRoot?: string;
    readonly defaultCwd?: string;
  };
  readonly webServer: {
    register(route: XrkWebServerRoute): void;
    registerUpgrade?(route: XrkWebServerUpgradeRoute): void;
    tapIndex?(fn: (html: string) => string): void;
  };
  readonly rpc: {
    register(channel: string, handler: CordisRpcHandler): void;
  };
  effect(fn: () => void | Promise<void>, _label?: string): void;
  provide?(_name: string, _value: unknown): void;
}

interface ApplyCollection {
  readonly http: Array<{
    match: (pathname: string) => boolean;
    handle: CordisHttpHandler;
  }>;
  readonly rpc: Record<string, CordisRpcHandler>;
  readonly disposers: Array<() => void | Promise<void>>;
}

const HOST_ENTRY_CANDIDATES = [
  "host.mjs",
  "host.js",
  "lib/host.mjs",
  "lib/host/index.mjs",
  "dist/host.mjs",
] as const;

function resolveHostEntry(pkgRoot: string): string | undefined {
  for (const rel of HOST_ENTRY_CANDIDATES) {
    const abs = path.join(pkgRoot, rel);
    if (existsSync(abs)) {
      try {
        return realpathSync.native(abs);
      } catch {
        return abs;
      }
    }
  }
  return undefined;
}

function routeMatcher(route: XrkWebServerRoute): (pathname: string) => boolean {
  const p = route.path.endsWith("/") ? route.path.slice(0, -1) : route.path;
  const kind = route.kind ?? "prefix";
  if (kind === "exact") {
    return (pathname) => pathname === p;
  }
  const prefix = p.endsWith("/") ? p : `${p}/`;
  return (pathname) => pathname === p || pathname.startsWith(prefix);
}

function createApplyCollection(): ApplyCollection {
  return {
    http: [],
    rpc: {},
    disposers: [],
  };
}

function wireCollection(
  collection: ApplyCollection,
  partial: HostProviderPartial,
): void {
  if (partial.http?.length) {
    for (const row of partial.http) {
      collection.http.push({
        match: row.match,
        handle: row.handle,
      });
    }
  }
  if (partial.rpc) {
    for (const [channel, handler] of Object.entries(partial.rpc)) {
      collection.rpc[channel] = handler;
    }
  }
}

export function createXrkHostApplyContext(
  packageName: string,
  pkgRoot: string,
  wire: DshCompatWireOptions,
  collection: ApplyCollection,
): XrkHostApplyContext {
  const ctx: XrkHostApplyContext = {
    ...wire,
    packageName,
    pkgRoot,
    paths: {
      pkgRoot,
      ...(wire.pluginsDir ? { pluginsDir: wire.pluginsDir } : {}),
      ...(wire.xrkHome ? { xrkHome: wire.xrkHome } : {}),
      ...(wire.workspaceRoot ? { workspaceRoot: wire.workspaceRoot } : {}),
      ...(wire.defaultCwd ? { defaultCwd: wire.defaultCwd } : {}),
    },
    webServer: {
      register(route) {
        const methods = route.methods?.map((m) => m.toUpperCase());
        const match = routeMatcher(route);
        collection.http.push({
          match,
          handle: async (req, res, pathname) => {
            const method = (req.method ?? "GET").toUpperCase();
            if (methods?.length && !methods.includes(method)) {
              return false;
            }
            const result = await route.handler(req, res, pathname);
            return result === undefined ? true : Boolean(result);
          },
        });
      },
      registerUpgrade(route) {
        registerDshCompatUpgrade({
          path: route.path,
          packageName,
          ...(route.handler ? { handler: route.handler } : {}),
        });
      },
      tapIndex(_fn) {
        /* index HTML tap is client boot policy on XRK */
      },
    },
    rpc: {
      register(channel, handler) {
        const key = channel.endsWith("/") ? channel.slice(0, -1) : channel;
        collection.rpc[key] = handler;
      },
    },
    effect(fn, _label) {
      collection.disposers.push(fn);
    },
    provide(_name, _value) {
      /* Cordis DI not embedded — no-op for apply compatibility */
    },
  };
  return ctx;
}

async function invokeHostContribution(
  mod: {
    apply?: (c: XrkHostApplyContext) => void | Promise<void>;
    createHostContribution?: (
      c: XrkHostApplyContext | DshCompatWireOptions,
    ) => HostProviderPartial | Promise<HostProviderPartial>;
    default?: unknown;
  },
  ctx: XrkHostApplyContext,
  wire: DshCompatWireOptions,
  collection: ApplyCollection,
): Promise<boolean> {
  if (typeof mod.apply === "function") {
    await mod.apply(ctx);
    return true;
  }
  if (typeof mod.createHostContribution === "function") {
    wireCollection(collection, await mod.createHostContribution(ctx));
    return true;
  }
  if (
    mod.default &&
    typeof mod.default === "object" &&
    typeof (mod.default as { createHostContribution?: unknown })
      .createHostContribution === "function"
  ) {
    wireCollection(
      collection,
      await (
        mod.default as {
          createHostContribution: (
            c: XrkHostApplyContext | DshCompatWireOptions,
          ) => HostProviderPartial | Promise<HostProviderPartial>;
        }
      ).createHostContribution(ctx),
    );
    return true;
  }
  return false;
}

export async function tryApplyHostModule(
  pkgRoot: string,
  packageName: string,
  wire: DshCompatWireOptions,
): Promise<DshAdapterContribution | undefined> {
  const entry = resolveHostEntry(pkgRoot);
  if (!entry) return undefined;

  const collection = createApplyCollection();
  const ctx = createXrkHostApplyContext(packageName, pkgRoot, wire, collection);

  try {
    const href = pathToFileURL(entry).href;
    const mod = (await import(/* @vite-ignore */ href)) as {
      apply?: (c: XrkHostApplyContext) => void | Promise<void>;
      createHostContribution?: (
        c: XrkHostApplyContext | DshCompatWireOptions,
      ) => HostProviderPartial | Promise<HostProviderPartial>;
      default?: unknown;
    };

    if (!(await invokeHostContribution(mod, ctx, wire, collection))) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  if (
    collection.http.length === 0 &&
    Object.keys(collection.rpc).length === 0
  ) {
    return undefined;
  }

  const id = packageName.replace(/^@/, "").replace(/\//g, "-");
  const httpPrefixes = collection.http
    .map((row) => {
      const probe = ["/_dsh/", "/api/", "/sidebar/"];
      for (const p of probe) {
        if (row.match(p)) return p;
      }
      return "apply";
    })
    .filter((p, i, a) => a.indexOf(p) === i);

  return {
    meta: {
      id: `${id}-apply`,
      package: packageName,
      httpPrefixes,
      rpcChannels: Object.keys(collection.rpc),
    },
    ...(collection.http.length ? { http: collection.http } : {}),
    ...(Object.keys(collection.rpc).length ? { rpc: collection.rpc } : {}),
  };
}

export function recordAppliedHostContribution(
  contribution: DshAdapterContribution,
): void {
  const pkg = contribution.meta.package;
  if (!pkg) return;
  registerHostApply({
    packageName: pkg,
    httpPrefixes: contribution.meta.httpPrefixes ?? [],
    rpcChannels: contribution.meta.rpcChannels ?? [],
  });
}

export function hasHostApplyEntry(pkgRoot: string): boolean {
  return Boolean(resolveHostEntry(pkgRoot));
}

export const XRK_HOST_APPLY_ADAPTER = DSH_COMPAT_ADAPTER;
