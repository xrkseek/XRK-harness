/**
 * Shared Cordis Context bootstrap for community host halves (OFM, WorkBuddy, …).
 *
 * Owns: Context · logger · webServer/rpc/connection · credentials · settings stub ·
 * effect/fiber tracking · apply + await · live dispose gate.
 * Callers keep package-specific seed / bridge / HTTP nudge.
 */
import { pathToFileURL } from "node:url";
import { Context } from "@xrkseek/cordis";
import {
  createCordisConnectionBridge,
  pushCordisWebServerRoute,
  type CordisHttpRow,
} from "./cordis-connection-bridge.js";
import { createCordisCredentialsBridge } from "./cordis-credentials-bridge.js";
import type { CordisRpcHandler } from "./cordis-registry.js";
import {
  gateLiveHostHttp,
  gateLiveHostRpc,
  registerLiveHostApply,
} from "./live-host-apply.js";
import { resolveCompatHome } from "./underlying/json-store.js";
import type { XrkWebServerRoute } from "./xrk-host-apply.js";

export type CommunityCordisHostLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type CommunityCordisHostSession = {
  readonly root: Context;
  readonly http: CordisHttpRow[];
  readonly rpc: Record<string, CordisRpcHandler>;
  readonly disposers: Array<() => void | Promise<void>>;
  readonly logger: CommunityCordisHostLogger;
  readonly dshHome: string;
  sealHttp(): void;
  isHttpSealed(): boolean;
  /** Wire webServer · rpc · connection · credentials · settings (+ optional extras). */
  provideHostSurfaces(options?: {
    readonly settingsConfigure?: boolean;
    readonly profileContext?: { readonly name: string; readonly home: string };
    readonly attachments?: unknown;
    readonly commands?: boolean;
  }): void;
  /** Track Cordis effect + child plugin fibers for await/dispose. */
  trackEffectsAndFibers(): void;
  /**
   * Import `entryPath` and call `apply(root, config)`. Awaits inject fibers.
   * On failure runs disposers and returns false.
   */
  applyEntry(
    entryPath: string,
    config: Record<string, unknown>,
    onFail?: () => void,
  ): Promise<boolean>;
  /** Register live dispose + gate HTTP/RPC for soft-disable. */
  finishLive(packageName: string): Promise<{
    readonly http: ReturnType<typeof gateLiveHostHttp>;
    readonly rpc: ReturnType<typeof gateLiveHostRpc>;
  }>;
};

type ApplyModule = {
  apply?: (ctx: Context, config?: Record<string, unknown>) => void;
};

type AwaitableFiber = { await: () => Promise<unknown> };

/**
 * Open a Cordis root for one staged community host package.
 */
export function createCommunityCordisHostSession(options: {
  readonly logPrefix: string;
  readonly packageName: string;
  readonly xrkHome?: string;
}): CommunityCordisHostSession {
  const logPrefix = options.logPrefix;
  const dshHome = resolveCompatHome(options.xrkHome);
  const http: CordisHttpRow[] = [];
  const rpc: Record<string, CordisRpcHandler> = {};
  const disposers: Array<() => void | Promise<void>> = [];
  let httpSealed = false;

  const root = new Context();
  const logger: CommunityCordisHostLogger = {
    info: (...args: unknown[]) => console.info(`[${logPrefix}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${logPrefix}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${logPrefix}]`, ...args),
  };

  root.logger.exporter({
    colors: false,
    export(message) {
      const line = `[${logPrefix}] ${message.type} ${message.name}: ${message.args.map(String).join(" ")}`;
      if (message.type === "error") console.error(line);
      else if (message.type === "warn") console.warn(line);
      else console.info(line);
    },
  });

  const childFibers: AwaitableFiber[] = [];

  const session: CommunityCordisHostSession = {
    root,
    http,
    rpc,
    disposers,
    logger,
    dshHome,
    sealHttp() {
      httpSealed = true;
    },
    isHttpSealed() {
      return httpSealed;
    },
    provideHostSurfaces(surface) {
      root.provide("webServer", {
        register(route: XrkWebServerRoute) {
          pushCordisWebServerRoute(http, route);
          return () => undefined;
        },
        registerUpgrade() {
          /* SSE / unary HTTP covers community status surfaces */
        },
        tapIndex() {
          return () => undefined;
        },
      });

      root.provide("rpc", {
        register(channel: string, handler: CordisRpcHandler) {
          const key = channel.endsWith("/") ? channel.slice(0, -1) : channel;
          rpc[key] = handler;
        },
      });

      root.provide(
        "connection",
        createCordisConnectionBridge({
          http,
          isSealed: () => httpSealed,
          onLateMiss: (p) =>
            logger.warn(
              `late connection.fetch register missed active registry for ${p}`,
            ),
        }),
      );

      root.provide(
        "credentials",
        createCordisCredentialsBridge(dshHome, options.packageName),
      );

      const settingsBase = {
        installSection() {
          return () => undefined;
        },
        async update() {
          return undefined;
        },
      };
      root.provide(
        "settings",
        surface?.settingsConfigure
          ? {
              ...settingsBase,
              configure() {
                return () => undefined;
              },
            }
          : settingsBase,
      );

      if (surface?.profileContext) {
        root.provide("profileContext", surface.profileContext);
      }
      if (surface?.attachments !== undefined) {
        root.provide("attachments", surface.attachments);
      }
      if (surface?.commands) {
        root.provide("commands", {
          register() {
            return () => undefined;
          },
        });
      }
    },
    trackEffectsAndFibers() {
      const originalEffect = root.effect.bind(root);
      root.effect = ((fn: Parameters<typeof root.effect>[0], label?: string) => {
        const owned = originalEffect(fn, label);
        disposers.push(() => {
          void owned();
        });
        return owned;
      }) as typeof root.effect;

      const registryPlugin = root.registry.plugin.bind(root.registry);
      root.registry.plugin = ((plugin, config?, getOuterStack?) => {
        const fiber = registryPlugin(plugin, config, getOuterStack);
        childFibers.push(fiber);
        return fiber;
      }) as typeof root.registry.plugin;
    },
    async applyEntry(entryPath, config, onFail) {
      try {
        const entry = pathToFileURL(entryPath).href;
        const mod = (await import(/* @vite-ignore */ entry)) as ApplyModule;
        if (typeof mod.apply !== "function") return false;
        mod.apply(root, config);
        await Promise.all(childFibers.map((fiber) => fiber.await()));
        return true;
      } catch (error) {
        logger.error("host apply failed", error);
        onFail?.();
        for (const d of disposers.reverse()) await d();
        return false;
      }
    },
    async finishLive(packageName) {
      await registerLiveHostApply(packageName, async () => {
        for (const d of disposers.reverse()) await d();
        try {
          await root.fiber.dispose();
        } catch {
          /* Cordis root may already be torn down */
        }
      });
      return {
        http: gateLiveHostHttp(packageName, http),
        rpc: gateLiveHostRpc(packageName, rpc),
      };
    },
  };

  return session;
}
