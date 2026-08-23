/**
 * 底层：Cordis `*-settings` RPC → 持久化 settings 文档。
 */
import type {
  HostProviderPartial,
  PluginHostRpcRoute,
} from "../adapter-types.js";
import { handleSettingsEndpoint } from "../settings-store.js";
import { createPersistedSettingsDocStore } from "../persisted-settings-store.js";
import { settingsFallbackHome } from "../cordis-settings-fallback.js";

export function settingsRpcProvider(
  route: PluginHostRpcRoute,
): HostProviderPartial {
  const o = route.options ?? {};
  const namespace = typeof o.namespace === "string" ? o.namespace : "default";
  const mode =
    o.mode === "scope-snapshot" ? "scope-snapshot" : "remote-describe";
  const defaults =
    o.defaults && typeof o.defaults === "object" && !Array.isArray(o.defaults)
      ? (o.defaults as Record<string, unknown>)
      : {};
  const altNamespace =
    typeof o.altNamespace === "string" ? o.altNamespace : undefined;
  const altDefaults =
    o.altDefaults && typeof o.altDefaults === "object"
      ? (o.altDefaults as Record<string, unknown>)
      : undefined;
  const nsKey =
    typeof o.namespacePayloadKey === "string"
      ? o.namespacePayloadKey
      : "namespace";

  const primary = createPersistedSettingsDocStore(
    settingsFallbackHome(),
    namespace,
    defaults,
  );
  const alt =
    altNamespace && altDefaults
      ? createPersistedSettingsDocStore(
          settingsFallbackHome(),
          altNamespace,
          altDefaults,
        )
      : undefined;

  return {
    rpc: {
      [route.channel]: (endpoint, payload) => {
        const store =
          alt && payload[nsKey] === altNamespace ? alt : primary;
        return handleSettingsEndpoint(store, endpoint, payload, mode);
      },
    },
  };
}
