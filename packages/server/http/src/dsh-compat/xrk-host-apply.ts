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
import {
  createCordisConnectionBridge,
  pushCordisWebServerRoute,
} from "./cordis-connection-bridge.js";
import { createCordisCredentialsBridge } from "./cordis-credentials-bridge.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { registerDshCompatUpgrade } from "./dsh-compat-upgrades.js";
import { registerHostApply } from "./host-apply-registry.js";
import {
  gateLiveHostHttp,
  gateLiveHostRpc,
  registerLiveHostApply,
} from "./live-host-apply.js";
import { resolveCompatHome } from "./underlying/json-store.js";

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
  /** Cordis-shaped DI store for host.mjs `ctx.provide` / `ctx.get`. */
  provide(name: string, value: unknown): void;
  get(name: string): unknown;
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
): XrkHostApplyContext & { sealHttp: () => void } {
  // Thin DI bag — not a full Cordis Host; enough for host.mjs provide/get.
  const services = new Map<string, unknown>();
  const sealState = { sealed: false };
  const ctx: XrkHostApplyContext & { sealHttp: () => void } = {
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
        pushCordisWebServerRoute(collection.http, route);
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
    provide(name, value) {
      services.set(name, value);
    },
    get(name) {
      return services.get(name);
    },
    sealHttp() {
      sealState.sealed = true;
    },
  };
  // Pre-seed DSH connection / credentials so host.mjs packs that inject them
  // (trust fence, channel-pack style fetch.register, OAuth pools) do not 503.
  services.set(
    "connection",
    createCordisConnectionBridge({
      http: collection.http,
      isSealed: () => sealState.sealed,
    }),
  );
  services.set(
    "credentials",
    createCordisCredentialsBridge(
      resolveCompatHome(wire.xrkHome),
      packageName,
    ),
  );
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
    ctx.sealHttp();
  } catch {
    return undefined;
  }

  if (
    collection.http.length === 0 &&
    Object.keys(collection.rpc).length === 0
  ) {
    return undefined;
  }

  await registerLiveHostApply(packageName, async () => {
    for (const d of collection.disposers.reverse()) await d();
  });

  const gatedHttp = gateLiveHostHttp(packageName, collection.http);
  const gatedRpc = gateLiveHostRpc(packageName, collection.rpc);

  const id = packageName.replace(/^@/, "").replace(/\//g, "-");
  const httpPrefixes = gatedHttp
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
      rpcChannels: Object.keys(gatedRpc),
    },
    ...(gatedHttp.length ? { http: gatedHttp } : {}),
    ...(Object.keys(gatedRpc).length ? { rpc: gatedRpc } : {}),
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
