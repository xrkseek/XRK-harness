/**
 * Shared Cordis Context bootstrap for community host halves (OFM, WorkBuddy,
 * wallpaper, nekowhale, …).
 *
 * Owns: Context · logger · webServer/rpc/connection · credentials · settings ·
 * tools/skills/systemPrompt · effect/fiber tracking · apply + await · live dispose.
 * Callers keep package-specific seed / bridge / HTTP nudge.
 */
import { pathToFileURL } from "node:url";
import { Context, Service } from "@xrkseek/cordis";
import {
  createCordisConnectionBridge,
  pushCordisWebServerRoute,
  type CordisHttpRow,
} from "./cordis-connection-bridge.js";
import { createCordisCredentialsBridge } from "./cordis-credentials-bridge.js";
import type { CordisRpcHandler } from "./cordis-registry.js";
import {
  createCommunityIndexInjectBridge,
  provideCommunityAgentSurfaces,
  type CommunityIndexInjectBridge,
  type CommunitySettingsBridge,
  type CommunitySettingsStore,
  type CommunitySkillsBridge,
  type CommunitySystemPromptBridge,
  type CommunityToolsBridge,
} from "./community-cordis-surfaces.js";
import {
  gateLiveHostHttp,
  gateLiveHostRpc,
  registerLiveHostApply,
} from "./live-host-apply.js";
import { resolveCompatHome } from "./underlying/json-store.js";
import type { XrkWebServerRoute } from "./xrk-host-apply.js";

/**
 * Fiber-scoped webServer: register binds to the *caller* fiber so Agent
 * remount drops routes (plain provide + noop disposer left duplicates).
 */
class CommunityWebServerService extends Service {
  constructor(
    ctx: Context,
    private readonly http: CordisHttpRow[],
  ) {
    super(ctx, "webServer");
  }

  register(route: XrkWebServerRoute): () => void {
    const dispose = this.ctx.effect(() => {
      const drop = pushCordisWebServerRoute(this.http, route);
      return () => {
        drop();
      };
    }, `webServer.register(${JSON.stringify(route.path)})`);
    return () => {
      void dispose();
    };
  }

  registerUpgrade(): void {
    /* SSE / unary HTTP covers community status surfaces */
  }

  tapIndex(): () => void {
    return () => undefined;
  }

  get port(): number | undefined {
    const raw = process.env.XRK_FACE_PORT ?? process.env.PORT;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
}

/**
 * Fiber-scoped rpc: remount must drop channels registered on the disposed fiber.
 * Same-channel overwrite still wins for the active fiber.
 */
class CommunityRpcService extends Service {
  constructor(
    ctx: Context,
    private readonly rpc: Record<string, CordisRpcHandler>,
  ) {
    super(ctx, "rpc");
  }

  register(channel: string, handler: CordisRpcHandler): () => void {
    const key = channel.endsWith("/") ? channel.slice(0, -1) : channel.trim();
    if (!key) return () => undefined;
    const dispose = this.ctx.effect(() => {
      const previous = this.rpc[key];
      this.rpc[key] = handler;
      return () => {
        if (this.rpc[key] === handler) {
          if (previous) this.rpc[key] = previous;
          else delete this.rpc[key];
        }
      };
    }, `rpc.register(${JSON.stringify(key)})`);
    return () => {
      void dispose();
    };
  }
}

async function drainDisposers(
  disposers: Array<() => void | Promise<void>>,
): Promise<void> {
  // Copy + reverse without mutating the live list (apply fail + finishLive
  // both drain; in-place reverse() corrupted the second pass).
  const stack = disposers.splice(0).reverse();
  for (const d of stack) {
    try {
      await d();
    } catch {
      /* best-effort teardown */
    }
  }
}

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
  /** Agent surfaces — present after {@link CommunityCordisHostSession.provideHostSurfaces}. */
  readonly agent:
    | {
        readonly tools: CommunityToolsBridge;
        readonly skills: CommunitySkillsBridge;
        readonly systemPrompt: CommunitySystemPromptBridge;
        readonly settings: CommunitySettingsBridge;
        readonly indexInject: CommunityIndexInjectBridge;
      }
    | undefined;
  sealHttp(): void;
  isHttpSealed(): boolean;
  /** Wire webServer · rpc · connection · credentials · settings (+ optional extras). */
  provideHostSurfaces(options?: {
    readonly settingsConfigure?: boolean;
    readonly profileContext?: { readonly name: string; readonly home: string };
    readonly attachments?: unknown;
    readonly commands?: boolean;
    /** Collect tools/skills/systemPrompt (nekowhale and peers). */
    readonly agentSurfaces?: boolean;
    readonly settingsStore?: CommunitySettingsStore;
    readonly onSettingsChange?: (namespace: string) => void;
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
  /** Schemastery Config — call to fill defaults before `apply`. */
  Config?: ((data?: unknown) => unknown) | unknown;
  default?: {
    apply?: (ctx: Context, config?: Record<string, unknown>) => void;
    Config?: ((data?: unknown) => unknown) | unknown;
  };
};

/**
 * Community plugins expect Cordis to hand `apply` a Config-resolved object
 * (defaults filled). Without this, `site: config.site` overwrites kit defaults
 * with `undefined` and crashes (nekowhale StickerKit).
 */
function resolveApplyConfig(
  mod: ApplyModule,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const raw = config ?? {};
  const Config =
    typeof mod.Config === "function"
      ? mod.Config
      : typeof mod.default?.Config === "function"
        ? mod.default.Config
        : undefined;
  if (!Config) return raw;
  try {
    const resolved = Config(raw);
    if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
      return resolved as Record<string, unknown>;
    }
  } catch {
    /* keep seed — unit fakes may export a non-schema Config */
  }
  return raw;
}

type AwaitableFiber = {
  await: () => Promise<unknown>;
};

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
  let surfacesProvided = false;
  let tracking = false;
  let agent:
    | {
        readonly tools: CommunityToolsBridge;
        readonly skills: CommunitySkillsBridge;
        readonly systemPrompt: CommunitySystemPromptBridge;
        readonly settings: CommunitySettingsBridge;
        readonly indexInject: CommunityIndexInjectBridge;
      }
    | undefined;

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
    get agent() {
      return agent;
    },
    sealHttp() {
      httpSealed = true;
    },
    isHttpSealed() {
      return httpSealed;
    },
    provideHostSurfaces(surface) {
      if (surfacesProvided) {
        throw new Error(
          `[${logPrefix}] provideHostSurfaces called twice — surfaces are single-shot`,
        );
      }
      surfacesProvided = true;

      new CommunityWebServerService(root, http);
      new CommunityRpcService(root, rpc);

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

      if (surface?.agentSurfaces) {
        agent = provideCommunityAgentSurfaces(root, {
          settingsConfigure: surface.settingsConfigure !== false,
          ...(surface.settingsStore
            ? { settingsStore: surface.settingsStore }
            : {}),
          ...(surface.onSettingsChange
            ? { onSettingsChange: surface.onSettingsChange }
            : {}),
        });
      } else {
        const settingsBase = {
          installSection() {
            return () => undefined;
          },
          async update() {
            return undefined;
          },
          configure() {
            return () => undefined;
          },
          peek() {
            return {};
          },
        } satisfies CommunitySettingsBridge;
        root.provide(
          "settings",
          surface?.settingsConfigure
            ? settingsBase
            : {
                installSection: (...args: Parameters<typeof settingsBase.installSection>) =>
                  settingsBase.installSection(...args),
                update: (...args: Parameters<typeof settingsBase.update>) =>
                  settingsBase.update(...args),
              },
        );
        // Index-inject collector still available for packages that only need HTTP.
        const indexInject = createCommunityIndexInjectBridge();
        agent = {
          tools: {
            register() {
              return () => undefined;
            },
            list: () => [],
            toCoreTools: () => [],
          },
          skills: {
            registerProvider() {
              return () => undefined;
            },
            providers: () => [],
            skillDirs: () => [],
            addSkillDir() {
              /* no-op */
            },
          },
          systemPrompt: {
            section() {
              return () => undefined;
            },
            sections: () => [],
          },
          settings: settingsBase,
          indexInject,
        };
      }

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
      if (tracking) {
        throw new Error(
          `[${logPrefix}] trackEffectsAndFibers called twice — tracking is single-shot`,
        );
      }
      tracking = true;

      // Do NOT wrap root.effect into disposers: Service registrations already
      // bind to fibers, and finishLive disposes root.fiber (which runs effects).
      // Double-owned() races soft-disable teardown.

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
        const apply =
          typeof mod.apply === "function"
            ? mod.apply
            : typeof mod.default?.apply === "function"
              ? mod.default.apply
              : undefined;
        if (typeof apply !== "function") return false;
        apply(root, resolveApplyConfig(mod, config));
        // Await a snapshot — remounts after settle push new fibers but apply
        // only needs the initial inject graph.
        const pending = childFibers.splice(0);
        await Promise.all(pending.map((fiber) => fiber.await()));
        // Harvest webserver/index-inject globals after fibers settle.
        agent?.indexInject.emit(root);
        return true;
      } catch (error) {
        logger.error("host apply failed", error);
        onFail?.();
        await drainDisposers(disposers);
        try {
          await root.fiber.dispose();
        } catch {
          /* already torn down */
        }
        return false;
      }
    },
    async finishLive(packageName) {
      await registerLiveHostApply(packageName, async () => {
        await drainDisposers(disposers);
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
