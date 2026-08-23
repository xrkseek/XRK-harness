/**
 * Plugin-declared host wire — no central plugin catalog in the kernel.
 */
import type {
  CordisHttpHandler,
  CordisRpcHandler,
} from "./cordis-registry.js";
import type { SidebarCompatOptions } from "./sidebar-adapter.js";
import type { TokenLedgerOptions } from "./tokenledger.js";
import type { HarnessConnectorOptions } from "./harness-connector.js";
import type { WalletOptions } from "./wallet.js";
import type { XrkPluginServicesOptions } from "../xrk/plugin-services.js";

export interface DshAdapterMeta {
  readonly id: string;
  readonly package?: string;
  readonly description?: string;
  readonly httpPrefixes?: readonly string[];
  readonly rpcChannels?: readonly string[];
}

export interface DshHttpRoute {
  readonly match: (pathname: string) => boolean;
  readonly handle: CordisHttpHandler;
}

export interface DshAdapterContribution {
  readonly meta: DshAdapterMeta;
  readonly rpc?: Readonly<Record<string, CordisRpcHandler>>;
  readonly http?: readonly DshHttpRoute[];
}

/** HTTP route declared in plugin `xrk.host.json`. */
export interface PluginHostHttpRoute {
  readonly prefix: string;
  /** XRK provider id — see {@link XRK_HOST_PROVIDERS}. */
  readonly provider: string;
  readonly options?: Record<string, unknown>;
}

/** RPC channel declared in plugin `xrk.host.json`. */
export interface PluginHostRpcRoute {
  readonly channel: string;
  readonly provider: string;
  readonly options?: Record<string, unknown>;
}

/**
 * Host manifest shipped with an installed client/process plugin.
 * File: `xrk.host.json` or `package.json` → `xrkseek.host` / `dsh.host`.
 */
export interface PluginHostManifest {
  readonly id?: string;
  readonly http?: readonly PluginHostHttpRoute[];
  readonly rpc?: readonly PluginHostRpcRoute[];
  /** Legacy shorthand → normalized to `xrk-stub` HTTP routes. */
  readonly httpPrefixes?: readonly string[];
  readonly rpcChannels?: readonly string[];
  readonly incomplete?: string;
}

export type DshCompatWireOptions = XrkPluginServicesOptions &
  SidebarCompatOptions &
  TokenLedgerOptions &
  HarnessConnectorOptions &
  Pick<WalletOptions, "walletPort" | "face" | "xrkHome"> & {
    readonly workspaceRoot?: string;
  };

export type HostProviderPartial = Pick<DshAdapterContribution, "http" | "rpc">;

export type HostProviderFn = (
  ctx: DshCompatWireOptions,
  route: PluginHostHttpRoute | PluginHostRpcRoute,
  pkgRoot: string,
  packageName: string,
) => HostProviderPartial | Promise<HostProviderPartial>;
