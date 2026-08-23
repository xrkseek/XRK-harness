/**
 * Factory for the DSH community adapter as a `kind: host` process plugin.
 * Canonical entry: `extensions/dsh-compat` (committed, not published).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  HostPublicHandlerFn,
  HostWireContext,
  PluginLoader,
  RegisteredPlugin,
} from "@xrkseek/server-loader";
import { PLUGIN_KINDS } from "@xrkseek/server-loader";
import {
  createDshCompatPublicHandler,
  type DshCompatOptions,
  type TokenLedgerOptions,
  type XrkWalletPort,
} from "./index.js";

export const DSH_COMPAT_HOST_PLUGIN_ID = "dsh-compat-host";

export type DshCompatHostPluginOptions = Omit<
  DshCompatOptions,
  "pluginsDir" | "xrkHome" | "workspaceRoot" | "defaultCwd" | "resolveSessionCwd"
> & {
  readonly tokenLedger?: Pick<
    TokenLedgerOptions,
    "aggregateUsage" | "fetchBalance" | "listUsageProviders"
  >;
  readonly harnessConnector?: Pick<
    import("./harness-connector.js").HarnessConnectorOptions,
    "onJobAccepted"
  >;
  readonly walletPort?: XrkWalletPort;
};

function optionsFromWire(
  ctx: HostWireContext,
  extra: DshCompatHostPluginOptions = {},
): DshCompatOptions {
  const fromCtx = ctx.tokenLedger;
  const fromExtra = extra.tokenLedger;
  const aggregateUsage =
    fromExtra?.aggregateUsage ?? fromCtx?.aggregateUsage;
  const fetchBalance = fromExtra?.fetchBalance ?? fromCtx?.fetchBalance;
  const listUsageProviders = fromCtx?.listUsageProviders;
  const onJobAccepted =
    ctx.harnessConnector?.onJobAccepted ?? extra.harnessConnector?.onJobAccepted;
  const walletPort = (ctx.walletPort ?? extra.walletPort) as
    | XrkWalletPort
    | undefined;
  return {
    ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
    ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
    ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
    ...(ctx.defaultCwd ? { defaultCwd: ctx.defaultCwd } : {}),
    ...(ctx.resolveSessionCwd
      ? { resolveSessionCwd: ctx.resolveSessionCwd }
      : {}),
    ...(aggregateUsage ? { aggregateUsage } : {}),
    ...(fetchBalance ? { fetchBalance } : {}),
    ...(listUsageProviders ? { listUsageProviders } : {}),
    ...(onJobAccepted ? { onJobAccepted } : {}),
    ...(walletPort ? { walletPort } : {}),
  };
}

/**
 * Registerable Host plugin: one adapter surface for DSH community client plugins.
 * Prefer loading `extensions/dsh-compat` via {@link ensureDshCompatHostPlugin}.
 */
export function createDshCompatHostPlugin(
  extra: DshCompatHostPluginOptions = {},
): RegisteredPlugin {
  return {
    id: DSH_COMPAT_HOST_PLUGIN_ID,
    kind: PLUGIN_KINDS.host,
    createPublicHandler(ctx: HostWireContext): HostPublicHandlerFn {
      return createDshCompatPublicHandler(optionsFromWire(ctx, extra));
    },
  };
}

/** Load built-in `extensions/dsh-compat`, or inline-register when absent (npm CLI). */
export async function ensureDshCompatHostPlugin(
  loader: PluginLoader,
  options: { readonly cwd?: string } = {},
): Promise<void> {
  if (loader.list().some((p) => p.id === DSH_COMPAT_HOST_PLUGIN_ID)) return;

  const root = path.join(options.cwd ?? process.cwd(), "extensions", "dsh-compat");
  const manifest = path.join(root, "xrk.plugin.json");
  if (existsSync(manifest)) {
    const hits = await loader.discover(root);
    const hit = hits.find((h) => h.manifest.id === DSH_COMPAT_HOST_PLUGIN_ID);
    if (hit) {
      await loader.load(hit);
      return;
    }
  }

  loader.register(createDshCompatHostPlugin());
}
