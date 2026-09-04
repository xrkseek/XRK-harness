/**
 * DSH Cordis-shaped HTTP path → XRK provider mapping.
 * Convention table (not per-plugin catalog): any community client that hits
 * these paths gets the same Host capability.
 */
import type {
  PluginHostHttpRoute,
  PluginHostRpcRoute,
} from "./adapter-types.js";
import { dshSettingsDefaults } from "./settings-defaults.js";
import { shortPackageName } from "./dsh-package-names.js";

export interface DshHttpCapability {
  readonly prefix: string;
  readonly provider: string;
  readonly options?: Record<string, unknown>;
}

/** Standard DSH HTTP surfaces — mounted once for the whole compat host. */
export const DSH_HTTP_CAPABILITIES: readonly DshHttpCapability[] = [
  { prefix: "/api/wallet/", provider: "xrk-wallet" },
  { prefix: "/wallet/api/", provider: "xrk-wallet" },
  { prefix: "/api/memento/", provider: "xrk-memento" },
  { prefix: "/modlens", provider: "xrk-modlens" },
  { prefix: "/api-import/", provider: "xrk-chat-import" },
  { prefix: "/.well-known/dsh-genui", provider: "xrk-genui" },
  { prefix: "/_dsh/genui/", provider: "xrk-genui" },
  { prefix: "/_dsh/dsh-noema", provider: "xrk-noema" },
  { prefix: "/dsh-market", provider: "xrk-market" },
  { prefix: "/api/dsh-market", provider: "xrk-market" },
  { prefix: "/dream-skin/", provider: "xrk-dream-skin" },
  { prefix: "/api/undo", provider: "xrk-undo" },
  { prefix: "/wallpaper-engine", provider: "xrk-wallpaper" },
  { prefix: "/dsh-skin-market", provider: "xrk-skin-market" },
  { prefix: "/api/tokenledger", provider: "xrk-tokenledger" },
  { prefix: "/tokenledger", provider: "xrk-tokenledger" },
  { prefix: "/api/mobile-access/", provider: "xrk-mobile-access" },
  { prefix: "/api/im/", provider: "xrk-im-messaging" },
  { prefix: "/mobile-access/", provider: "xrk-mobile-access" },
  { prefix: "/tongflow/", provider: "xrk-tongflow" },
  { prefix: "/tongflow", provider: "xrk-tongflow" },
  { prefix: "/_dsh/vision-toolkit/", provider: "xrk-vision-http" },
  { prefix: "/_dsh/vision-router/", provider: "xrk-vision-http" },
  { prefix: "/_dsh/", provider: "xrk-dsh-http" },
  { prefix: "/modsearch", provider: "xrk-modsearch" },
  { prefix: "/api/task", provider: "xrk-tongflow" },
  { prefix: "/api/plugins", provider: "xrk-tongflow" },
  { prefix: "/api/upload", provider: "xrk-tongflow" },
  { prefix: "/api/material", provider: "xrk-tongflow" },
  { prefix: "/api/users", provider: "xrk-tongflow" },
  { prefix: "/plugins/install", provider: "xrk-tongflow" },
  { prefix: "/plugins", provider: "xrk-tongflow" },
  { prefix: "/health", provider: "xrk-tongflow" },
  { prefix: "/api/usage-stats", provider: "xrk-usage-stats" },
  { prefix: "/turn-rewind", provider: "xrk-turn-rewind" },
  { prefix: "/releases", provider: "xrk-releases" },
  { prefix: "/latest", provider: "xrk-releases" },
  { prefix: "/auto-review", provider: "xrk-auto-review" },
  { prefix: "/plugins/", provider: "xrk-plugin-http" },
  { prefix: "/import", provider: "xrk-genui" },
  { prefix: "/default", provider: "xrk-genui" },
  { prefix: "/preview", provider: "xrk-genui" },
  { prefix: "/api/harness/connector", provider: "xrk-harness-connector" },
  { prefix: "/projects", provider: "xrk-tongflow" },
  { prefix: "/Looks", provider: "xrk-tongflow" },
  { prefix: "/Materials", provider: "xrk-tongflow" },
  { prefix: "/__xrk_community_root__", provider: "xrk-community-root" },
] as const;

const MNEMON_RPC_CHANNELS = [
  "/dsh-mnemon-settings",
  "/dsh-mnemon-activation",
  "/dsh-mnemon-read",
  "/dsh-mnemon-write",
  "/dsh-mnemon-pack",
] as const;

const IM_RPC_CHANNELS = [
  "dingtalk",
  "feishu",
  "wecom",
  "qq",
  "telegram",
  "discord",
  "whatsapp",
  "slack",
  "weixin",
] as const;

const SPECIAL_RPC: Readonly<
  Record<string, { provider: string; options?: Record<string, unknown> }>
> = {
  "/dsh-pocket": { provider: "xrk-pocket" },
  "/modsearch": { provider: "xrk-modsearch" },
  "/dsh-noema": { provider: "xrk-noema" },
  "/office": { provider: "xrk-im-office" },
  ...Object.fromEntries(
    IM_RPC_CHANNELS.map((channel) => [
      `/${channel}`,
      { provider: "xrk-im-channel", options: { channel } },
    ]),
  ),
  ...Object.fromEntries(
    MNEMON_RPC_CHANNELS.map((channel) => [channel, { provider: "xrk-mnemon" }]),
  ),
};

const SETTINGS_DEFAULTS: Readonly<Record<string, Record<string, unknown>>> =
  new Proxy({}, {
    get(_t, prop: string) {
      return dshSettingsDefaults(prop);
    },
  });

/** Kebab-case namespaces that must not be camelCased from channel names. */
const SETTINGS_NAMESPACE_OVERRIDES: Readonly<Record<string, string>> = {
  "vision-router": "vision-router",
  "wallpaper-engine": "wallpaper-engine",
  "genui-design": "genui-design",
  "noema-memory": "noema-memory",
  "chat-import": "chat-import",
  costMeter: "costMeter",
  tokenLedger: "tokenLedger",
  poisonGuard: "poisonGuard",
};

function channelToNamespace(channel: string): string {
  let name = channel.replace(/^\//, "").replace(/-settings$/, "");
  if (SETTINGS_NAMESPACE_OVERRIDES[name]) {
    return SETTINGS_NAMESPACE_OVERRIDES[name]!;
  }
  if (name.startsWith("dsh-")) name = name.slice(4);
  if (SETTINGS_NAMESPACE_OVERRIDES[name]) {
    return SETTINGS_NAMESPACE_OVERRIDES[name]!;
  }
  if (name.startsWith("vision-")) return name;
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function httpCapabilityForPath(pathname: string): DshHttpCapability | undefined {
  let best: DshHttpCapability | undefined;
  for (const cap of DSH_HTTP_CAPABILITIES) {
    const norm = cap.prefix.endsWith("/") ? cap.prefix : `${cap.prefix}/`;
    if (pathname === cap.prefix || pathname.startsWith(norm)) {
      if (!best || cap.prefix.length > best.prefix.length) best = cap;
    }
  }
  return best;
}

export function resolveRpcRoute(
  channel: string,
  packageName: string,
): PluginHostRpcRoute {
  const key = channel.endsWith("/") ? channel.slice(0, -1) : channel;
  const special = SPECIAL_RPC[key];
  if (special) {
    return {
      channel: key,
      provider: special.provider,
      ...(special.options ? { options: special.options } : {}),
    };
  }

  const isSettings =
    key.endsWith("-settings") || key.includes("-settings");
  if (isSettings) {
    const ns = channelToNamespace(key);
    const defaults = SETTINGS_DEFAULTS[ns] ?? {};
    const mode =
      key.includes("vision-") || key.includes("cost-meter")
        ? "remote-describe"
        : "scope-snapshot";
    return {
      channel: key,
      provider: "xrk-settings-rpc",
      options: { namespace: ns, mode, defaults },
    };
  }

  return {
    channel: key,
    provider: "xrk-stub-rpc",
    options: { kind: "generic", feature: shortPackageName(packageName) },
  };
}

export function conventionRpcChannels(
  packageName: string,
  scanned: readonly string[],
): string[] {
  const short = shortPackageName(packageName);
  const channels = new Set<string>(scanned);

  channels.add(`/${short}-settings`);
  channels.add(`/dsh-${short}-settings`);
  if (short.startsWith("dsh-")) {
    const stripped = short.slice(4);
    if (stripped) {
      channels.add(`/${stripped}-settings`);
      channels.add(`/dsh-${stripped}-settings`);
      channels.add(`/${short}`);
    }
  }
  if (short === "dshmarket" || short === "dsh-market") {
    channels.add("/dshmarket-settings");
  }
  if (short === "dsh-mnemon" || short.includes("mnemon")) {
    for (const ch of MNEMON_RPC_CHANNELS) channels.add(ch);
  }
  if (short === "dsh-pocket" || short.includes("pocket")) {
    channels.add("/dsh-pocket");
  }
  if (short.includes("weixin") || short.includes("im-weixin")) {
    channels.add("/weixin");
  }
  if (short.includes("auto-review") || short === "dsh-auto-review") {
    channels.add("/autoReview-settings");
    channels.add("/dsh-autoReview-settings");
  }
  if (short === "dsh-im" || short.endsWith("/dsh-im")) {
    channels.add("/office");
    for (const ch of IM_RPC_CHANNELS) channels.add(`/${ch}`);
  }

  return [...channels].sort();
}

export function baselineHttpRoutes(): PluginHostHttpRoute[] {
  return DSH_HTTP_CAPABILITIES.map((cap) => ({
    prefix: cap.prefix,
    provider: cap.provider,
    ...(cap.options ? { options: cap.options } : {}),
  }));
}

export function baselineRpcRoutes(): PluginHostRpcRoute[] {
  return Object.entries(SPECIAL_RPC).map(([channel, row]) => ({
    channel,
    provider: row.provider,
    ...(row.options ? { options: row.options } : {}),
  }));
}

export function listDshHttpCapabilityPrefixes(): readonly string[] {
  return DSH_HTTP_CAPABILITIES.map((c) => c.prefix);
}

/** True when a path is the HTTP face of a registered baseline RPC channel (audit only). */
export function matchesBaselineRpcChannel(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  if (p.includes("-settings")) return true;
  for (const row of baselineRpcRoutes()) {
    const ch = row.channel;
    if (p === ch || p.startsWith(`${ch}/`)) return true;
  }
  return false;
}
