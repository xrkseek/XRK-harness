/**
 * Process `kind: channel` plugins + DSH IM channel ids for Face discover.
 */
import type { PluginChannelRegistration } from "@xrkseek/server-loader";
import {
  collectChannelPluginRegistrations,
  wireCompositionChannels,
  type RegisteredPlugin,
} from "@xrkseek/server-loader";
import type { FaceProcessPlugin } from "./plugin-inventory.js";

/** IM vendors served by dsh-compat `im-channels` (webhook/poll/SSE · sidecar · WS client). */
export const FACE_IM_CHANNEL_STUBS = [
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

export type FaceImChannelStubId = (typeof FACE_IM_CHANNEL_STUBS)[number];

export type ImGatewayWired = "bridge" | "sidecar" | "ws-client";

export interface FaceProcessChannelEntry {
  readonly pluginId: string;
  readonly channelId: string;
  readonly displayName?: string;
  readonly source: "plugin";
  readonly wired: true;
}

export interface FaceImChannelEntry {
  readonly channelId: FaceImChannelStubId;
  readonly displayName: string;
  readonly source: "dsh-im";
  /** `bridge` = webhook/poll/SSE; `sidecar` / `ws-client` when gateway env set. */
  readonly wired: ImGatewayWired;
  readonly gatewayRelayPath?: string;
  readonly gatewayHealthPath?: string;
}

export interface FaceChannelDiscoverPayload {
  readonly process: readonly FaceProcessChannelEntry[];
  readonly im: readonly FaceImChannelEntry[];
  readonly note: string;
}

const IM_LABELS: Record<FaceImChannelStubId, string> = {
  dingtalk: "DingTalk",
  feishu: "Feishu / Lark",
  wecom: "WeCom",
  qq: "QQ",
  telegram: "Telegram",
  discord: "Discord",
  whatsapp: "WhatsApp",
  slack: "Slack",
  weixin: "WeChat",
};

/** Resolve IM gateway wiring from Host env (ADR-0006). */
export function resolveImGatewayWired(
  env: NodeJS.ProcessEnv = process.env,
): ImGatewayWired {
  if (env.XRK_IM_GATEWAY_WS_URL?.trim()) return "ws-client";
  if (env.XRK_IM_GATEWAY_URL?.trim()) return "sidecar";
  return "bridge";
}

function asRegisteredPlugins(
  plugins: readonly FaceProcessPlugin[] | undefined,
): readonly RegisteredPlugin[] {
  return plugins ?? [];
}

function processEntries(
  plugins: readonly FaceProcessPlugin[] | undefined,
): FaceProcessChannelEntry[] {
  const registered = asRegisteredPlugins(plugins);
  const applied = wireCompositionChannels({ plugins: registered }).applied;
  const appliedSet = new Set(
    applied.map((row) => `${row.pluginId}:${row.channelId}`),
  );
  return collectChannelPluginRegistrations(registered)
    .filter((row) => appliedSet.has(`${row.pluginId}:${row.channelId}`))
    .map((row: PluginChannelRegistration) => ({
      pluginId: row.pluginId,
      channelId: row.channelId,
      ...(row.displayName !== undefined ? { displayName: row.displayName } : {}),
      source: "plugin" as const,
      wired: true as const,
    }));
}

function imEntries(wired: ImGatewayWired): FaceImChannelEntry[] {
  return FACE_IM_CHANNEL_STUBS.map((channelId) => ({
    channelId,
    displayName: IM_LABELS[channelId],
    source: "dsh-im" as const,
    wired,
    ...(wired !== "bridge"
      ? {
          gatewayRelayPath: "/api/im/gateway/relay",
          gatewayHealthPath: "/api/im/gateway/health",
        }
      : {}),
  }));
}

function gatewayDiscoverNote(wired: ImGatewayWired): string {
  if (wired === "ws-client") {
    return " IM in-process WS client (XRK_IM_GATEWAY_WS_URL); relay at /api/im/gateway/relay when sidecar URL also set.";
  }
  if (wired === "sidecar") {
    return " IM sidecar env set (XRK_IM_GATEWAY_URL); relay at /api/im/gateway/relay.";
  }
  return "";
}

/** Face `processChannels/list` + settings discover payload. */
export function buildFaceChannelDiscover(
  plugins: readonly FaceProcessPlugin[] | undefined,
  options: {
    imGatewayWired?: ImGatewayWired;
    /** @deprecated use imGatewayWired */
    imSidecarConfigured?: boolean;
  } = {},
): FaceChannelDiscoverPayload {
  const wired =
    options.imGatewayWired ??
    (options.imSidecarConfigured ? "sidecar" : resolveImGatewayWired());
  return {
    process: processEntries(plugins),
    im: imEntries(wired),
    note:
      "Process channel plugins register connectors; IM vendors use dsh-compat RPC (webhook/poll/SSE bridge)." +
      gatewayDiscoverNote(wired),
  };
}
