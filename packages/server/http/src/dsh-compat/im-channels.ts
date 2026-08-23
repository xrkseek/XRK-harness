/**
 * Shared IM channel offline snapshot + RPC for @xmanrui/dsh-im channels.
 */
import { adapterEcho, imHostActionUnavailable } from "./honest-envelope.js";
import { validateImConnector } from "./host-feature-bridge.js";
import {
  beginImCallbackRepair,
  beginImProvision,
  cancelImProvision,
  pollImProvision,
} from "./im-provision-bridge.js";
import { handleImMessagingRpc } from "./im-messaging-bridge.js";
import { tag } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";

const IM_CHANNELS = new Set([
  "dingtalk",
  "feishu",
  "wecom",
  "qq",
  "telegram",
  "discord",
  "whatsapp",
  "slack",
  "weixin",
]);

const IM_UNAVAILABLE_ENDPOINTS = new Set<string>();

export function isImChannelName(channel: string): boolean {
  const name = channel.replace(/^\//, "");
  return IM_CHANNELS.has(name);
}

interface ImBotRow {
  botId: string;
  label: string;
  connected: boolean;
  state: string;
  workspace?: string;
  preset?: string;
  connector?: Record<string, unknown>;
  credentialsBound?: boolean;
}

interface ImChannelData {
  bots: ImBotRow[];
}

const EMPTY_CHANNEL: ImChannelData = { bots: [] };

function channelDocStore(channel: string) {
  return createXrkDocStore<ImChannelData>(
    ["im-channels", channel, "state.json"],
    EMPTY_CHANNEL,
  );
}

/** Legacy flat files may embed `revision` inside data — strip on read. */
function normalizeBots(raw: unknown): ImBotRow[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const bots = (raw as { bots?: unknown }).bots;
  if (!Array.isArray(bots)) return [];
  return bots.filter(
    (b): b is ImBotRow =>
      !!b &&
      typeof b === "object" &&
      typeof (b as ImBotRow).botId === "string",
  );
}

function readChannel(
  xrkHome: string | undefined,
  channel: string,
): { bots: ImBotRow[]; revision: number } {
  const doc = channelDocStore(channel).read(xrkHome);
  return { bots: normalizeBots(doc.data), revision: doc.revision };
}

function patchChannel(
  xrkHome: string | undefined,
  channel: string,
  mutator: (bots: ImBotRow[]) => ImBotRow[],
): { bots: ImBotRow[]; revision: number } {
  const doc = channelDocStore(channel).patch(xrkHome, (current) => ({
    bots: mutator(normalizeBots(current)),
  }));
  return { bots: doc.data.bots, revision: doc.revision };
}

function botIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const raw =
    payload.botId ?? payload.id ?? payload.bot_id ?? payload.botID;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function imChannelSnapshot(
  channel: string,
  store: { bots: ImBotRow[]; revision: number } = { bots: [], revision: 0 },
): Record<string, unknown> {
  const connected = store.bots.filter((b) => b.connected === true).length;
  const configured = store.bots.filter(
    (b) => b.state === "configured" || b.credentialsBound === true,
  ).length;
  return tag(
    {
      schemaVersion: 1,
      revision: store.revision,
      state: connected > 0 ? "connected" : configured > 0 ? "configured" : "offline",
      bots: store.bots,
      totals: { configured: store.bots.length, connected },
      provisioning: null,
      testMessage: null,
      agentPresetCatalog: { defaultId: "", items: [] },
      channel,
      note:
        connected > 0
          ? "XRK IM bridge: connector active via local tunnel simulation."
          : configured > 0
            ? "XRK IM bridge: connector saved — complete OAuth via provision.* or connection.test."
            : "XRK IM bridge: offline snapshot.",
      ...adapterEcho(),
    },
    connected > 0 ? undefined : configured > 0 ? ["im-host"] : ["im-host"],
  );
}

export interface ImChannelOptions {
  readonly xrkHome?: string;
}

export function handleImChannelRpc(
  channel: string,
  endpoint: string,
  payload: Record<string, unknown>,
  options: ImChannelOptions = {},
): unknown {
  const name = channel.replace(/^\//, "");
  if (!IM_CHANNELS.has(name)) {
    return { ok: false, error: "unknown im channel", channel };
  }
  const home = options.xrkHome;
  let store = readChannel(home, name);

  if (
    endpoint === "connection.status" ||
    endpoint === "status" ||
    endpoint === "bot.list" ||
    endpoint === "bots.list" ||
    endpoint === "bots" ||
    endpoint === ""
  ) {
    return imChannelSnapshot(name, store);
  }

  if (IM_UNAVAILABLE_ENDPOINTS.has(endpoint)) {
    return imHostActionUnavailable(name, endpoint);
  }

  if (endpoint === "provision.begin" || endpoint === "provision.start") {
    return beginImProvision(home, name, payload);
  }
  if (endpoint === "provision.poll" || endpoint === "provision.status") {
    return pollImProvision(home, name, payload);
  }
  if (endpoint === "provision.cancel") {
    return cancelImProvision(home, name, payload);
  }
  if (endpoint === "bot.callback-repair.begin") {
    return beginImCallbackRepair(name, payload);
  }

  if (endpoint === "connection.disconnect" || endpoint === "connector.remove") {
    const botId = botIdFromPayload(payload);
    store = patchChannel(home, name, (bots) =>
      bots.map((b) =>
        !botId || b.botId === botId
          ? { ...b, connected: false, state: "offline" }
          : b,
      ),
    );
    return {
      ...imChannelSnapshot(name, store),
      ok: true,
      disconnected: true,
      mode: "xrk-bridge",
    };
  }

  if (
    endpoint === "connection.test" ||
    endpoint === "connector.test" ||
    endpoint === "bot.reconnect" ||
    endpoint === "connector.reconnect"
  ) {
    const botId = botIdFromPayload(payload);
    const bot = botId
      ? store.bots.find((b) => b.botId === botId)
      : store.bots[0];
    if (!bot) {
      return { ok: false, code: "bot-missing", channel: name };
    }
    const check = validateImConnector(bot.connector);
    const ready = bot.credentialsBound === true || check.ok;
    if (!ready) {
      return {
        ...imHostActionUnavailable(
          name,
          endpoint,
          "Configure connector or bind credentials before test.",
        ),
        missing: check.missing,
      };
    }
    store = patchChannel(home, name, (bots) =>
      bots.map((b) =>
        b.botId === bot.botId
          ? {
              ...b,
              connected: true,
              state: "bridge-connected",
            }
          : b,
      ),
    );
    return {
      ...imChannelSnapshot(name, store),
      ok: true,
      tested: true,
      mode: "xrk-bridge",
      note: "Simulated tunnel handshake — live IM host not embedded.",
    };
  }

  if (endpoint === "bot.create" || endpoint === "bots.create") {
    const botId =
      botIdFromPayload(payload) ?? `bot-${Date.now()}`;
    const label =
      typeof payload.label === "string" ? payload.label : name;
    store = patchChannel(home, name, (bots) => [
      ...bots,
      {
        botId,
        label,
        connected: false,
        state: "offline",
      },
    ]);
    return imChannelSnapshot(name, store);
  }

  if (endpoint === "bot.delete" || endpoint === "bots.delete") {
    const botId = botIdFromPayload(payload);
    if (!botId) {
      return { ok: false, code: "bot-missing", channel: name };
    }
    store = patchChannel(home, name, (bots) =>
      bots.filter((b) => b.botId !== botId),
    );
    return imChannelSnapshot(name, store);
  }

  if (endpoint === "bot.disconnect" || endpoint === "bots.disconnect") {
    const botId = botIdFromPayload(payload);
    store = patchChannel(home, name, (bots) =>
      bots.map((b) =>
        botId && b.botId === botId
          ? { ...b, connected: false, state: "offline" }
          : b,
      ),
    );
    return imChannelSnapshot(name, store);
  }

  if (endpoint === "bot.bind-credentials" || endpoint === "bots.bind-credentials") {
    const botId = botIdFromPayload(payload);
    if (!botId) {
      return { ok: false, code: "bot-missing", channel: name };
    }
    store = patchChannel(home, name, (bots) => {
      const exists = bots.some((b) => b.botId === botId);
      if (!exists) {
        return [
          ...bots,
          {
            botId,
            label: name,
            connected: false,
            state: "configured",
            credentialsBound: true,
          },
        ];
      }
      return bots.map((b) =>
        b.botId === botId
          ? {
              ...b,
              credentialsBound: true,
              connected: false,
              state: "configured",
            }
          : b,
      );
    });
    return imChannelSnapshot(name, store);
  }

  if (endpoint === "connector.configure") {
    const botId = botIdFromPayload(payload);
    const connector =
      payload.connector && typeof payload.connector === "object"
        ? (payload.connector as Record<string, unknown>)
        : Object.fromEntries(
            Object.entries(payload).filter(
              ([key]) =>
                !["botId", "id", "bot_id", "botID", "connector"].includes(key),
            ),
          );
    if (!botId) {
      return { ok: false, code: "bot-missing", channel: name };
    }
    store = patchChannel(home, name, (bots) => {
      const existing = bots.find((b) => b.botId === botId);
      if (!existing) {
        return [
          ...bots,
          {
            botId,
            label: name,
            connected: false,
            state: "configured",
            connector,
          },
        ];
      }
      return bots.map((b) =>
        b.botId === botId
          ? {
              ...b,
              connector,
              connected: false,
              state: "configured",
            }
          : b,
      );
    });
    return imChannelSnapshot(name, store);
  }

  if (
    endpoint === "bot.workspace.set" ||
    endpoint === "bot.preset.set" ||
    endpoint === "bots.update"
  ) {
    const botId = botIdFromPayload(payload);
    if (!botId) {
      return { ok: false, code: "bot-missing", channel: name };
    }
    store = patchChannel(home, name, (bots) =>
      bots.map((b) => {
        if (b.botId !== botId) return b;
        const row = { ...b };
        if (typeof payload.workspace === "string") {
          row.workspace = payload.workspace;
        }
        if (typeof payload.preset === "string") {
          row.preset = payload.preset;
        }
        if (typeof payload.label === "string") {
          row.label = payload.label;
        }
        return row;
      }),
    );
    return imChannelSnapshot(name, store);
  }

  const messaging = handleImMessagingRpc(name, endpoint, payload, home);
  if (messaging) return messaging;

  return tag(
    {
      ok: false,
      endpoint,
      channel: name,
      ...adapterEcho(),
    },
    ["im-host"],
  );
}
