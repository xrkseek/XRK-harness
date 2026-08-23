/**
 * Lazy settings-RPC stores for unmatched `/*-settings` Cordis POST channels.
 */
import type { CordisRpcHandler } from "./cordis-registry.js";
import {
  handleSettingsEndpoint,
} from "./settings-store.js";
import { resolveRpcRoute } from "./dsh-path-capabilities.js";
import { createPersistedSettingsDocStore } from "./persisted-settings-store.js";
import { dshSettingsDefaults } from "./settings-defaults.js";
import type { SettingsDocStore } from "./settings-store.js";

let fallbackXrkHome: string | undefined;

const stores = new Map<string, SettingsDocStore>();

/** Wire Host `xrkHome` before handling unmatched settings RPC. */
export function configureSettingsFallback(options: {
  readonly xrkHome?: string;
}): void {
  fallbackXrkHome = options.xrkHome?.trim() || undefined;
}

export function settingsFallbackHome(): string | undefined {
  return fallbackXrkHome;
}

function storeForChannel(channel: string): SettingsDocStore {
  let row = stores.get(channel);
  if (!row) {
    const route = resolveRpcRoute(channel, channel.slice(1));
    const o = route.options ?? {};
    const namespace = typeof o.namespace === "string" ? o.namespace : "default";
    const defaults =
      o.defaults && typeof o.defaults === "object" && !Array.isArray(o.defaults)
        ? (o.defaults as Record<string, unknown>)
        : dshSettingsDefaults(namespace);
    row = createPersistedSettingsDocStore(
      fallbackXrkHome,
      namespace,
      defaults,
    );
    stores.set(channel, row);
  }
  return row;
}

export function trySettingsFallbackRpc(
  pathname: string,
  endpoint: string,
  payload: Record<string, unknown>,
): unknown | undefined {
  const slash = pathname.indexOf("/", 1);
  const channel = slash > 0 ? pathname.slice(0, slash) : pathname;
  if (!channel.endsWith("-settings")) return undefined;
  const route = resolveRpcRoute(channel, channel.slice(1));
  if (route.provider !== "xrk-settings-rpc") return undefined;
  const mode =
    route.options?.mode === "remote-describe"
      ? "remote-describe"
      : "scope-snapshot";
  const store = storeForChannel(channel);
  return handleSettingsEndpoint(store, endpoint || "get", payload, mode);
}

export function settingsFallbackHandler(channel: string): CordisRpcHandler {
  return (endpoint, payload) => {
    const value = trySettingsFallbackRpc(
      `${channel}/${endpoint}`,
      endpoint,
      payload,
    );
    return value ?? { ok: true, status: "ready", writable: true, value: {} };
  };
}
