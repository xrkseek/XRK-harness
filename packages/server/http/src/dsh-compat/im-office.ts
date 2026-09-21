/**
 * @xmanrui/dsh-im — AI Office channel RPC (`/office`).
 * Mutating connect endpoints evaluate Host `office.connect` policy.
 */
import type { PolicyEngine } from "@xrkseek/policy";
import {
  connectorJobSummary,
  readConnectorHeartbeat,
} from "./harness-connector-store.js";
import { honestReady } from "./honest-envelope.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import {
  enforceSidebarPolicy,
  type SidebarPolicyAskResolver,
} from "../sidebar/sidebar-policy.js";
import { HostPolicyError } from "../host-policy-error.js";

const PROTOCOL = "office-harness.v1";

const OFFICE_STORE = createXrkDocStore(
  ["im-office", "connector.json"],
  {
    configured: false,
    connected: false,
    state: "unconfigured",
    config: null as OfficeConfig | null,
  },
);

export interface ImOfficeOptions {
  readonly xrkHome?: string;
  readonly policy?: PolicyEngine;
  readonly resolvePolicyAsk?: SidebarPolicyAskResolver;
}

interface OfficeConfig {
  baseUrl: string;
  deviceId: string;
  maxConcurrency: number;
  heartbeatSeconds: number;
  token?: string;
}

interface OfficeStore {
  configured: boolean;
  connected: boolean;
  state: string;
  config: OfficeConfig | null;
}

function harnessBridge(xrkHome?: string): Record<string, unknown> {
  const lastHeartbeat = readConnectorHeartbeat(xrkHome);
  return {
    protocolVersion: PROTOCOL,
    lastHeartbeat,
    jobs: connectorJobSummary(xrkHome),
  };
}

function statusPayload(
  store: OfficeStore,
  xrkHome?: string,
  revision?: number,
): Record<string, unknown> {
  if (!store.configured || !store.config) {
    return {
      configured: false,
      connected: false,
      state: "unconfigured",
      config: null,
      health: null,
      harness: harnessBridge(xrkHome),
      adapter: DSH_COMPAT_ADAPTER,
      ...(revision !== undefined ? { revision } : {}),
    };
  }
  const heartbeat = readConnectorHeartbeat(xrkHome);
  const connected =
    store.connected ||
    (heartbeat != null && Date.now() - heartbeat < 120_000);
  return {
    configured: true,
    connected,
    state: connected ? store.state : "idle",
    tokenConfigured: Boolean(store.config.token),
    config: {
      protocolVersion: PROTOCOL,
      baseUrl: store.config.baseUrl,
      deviceId: store.config.deviceId,
      maxConcurrency: store.config.maxConcurrency,
      heartbeatSeconds: store.config.heartbeatSeconds,
      workspaces: {},
      instructionPresets: {},
      hooks: {},
    },
    health: connected
      ? { lastHeartbeat: heartbeat ?? Date.now(), ok: true }
      : { ok: false, reason: "awaiting-heartbeat" },
    harness: harnessBridge(xrkHome),
    adapter: DSH_COMPAT_ADAPTER,
    ...(revision !== undefined ? { revision } : {}),
    ...honestReady(),
  };
}

function policyFail(wire: {
  readonly code: "policy-denied" | "policy-ask";
  readonly message: string;
  readonly details: {
    readonly kind: string;
    readonly reason: string;
    readonly ruleId?: string;
  };
}): never {
  throw new HostPolicyError(wire.code, wire.message, wire.details);
}

/** Endpoints that establish / change Office connector state. */
function isOfficeConnectMutation(endpoint: string): boolean {
  return (
    endpoint === "connector.configure" ||
    endpoint === "configure" ||
    endpoint === "connector.reconnect" ||
    endpoint === "reconnect" ||
    endpoint === "connector.test" ||
    endpoint === "test" ||
    endpoint === "connector.remove" ||
    endpoint === "remove"
  );
}

export async function handleOfficeRpc(
  endpoint: string,
  payload: Record<string, unknown>,
  options: ImOfficeOptions = {},
): Promise<unknown> {
  const home = options.xrkHome;
  const loaded = OFFICE_STORE.read(home);
  const store = loaded.data;

  if (endpoint === "connection.status" || endpoint === "status") {
    return statusPayload(store, home, loaded.revision);
  }

  if (isOfficeConnectMutation(endpoint)) {
    const sessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : undefined;
    const connectorId =
      typeof payload.deviceId === "string" && payload.deviceId.trim()
        ? payload.deviceId.trim()
        : store.config?.deviceId;
    const denied = await enforceSidebarPolicy(
      options.policy,
      {
        kind: "office.connect",
        ...(connectorId ? { connectorId } : {}),
      },
      {
        ...(options.resolvePolicyAsk
          ? { resolveAsk: options.resolvePolicyAsk }
          : {}),
        ...(sessionId ? { sessionId } : {}),
      },
    );
    if (denied) return policyFail(denied);
  }

  if (endpoint === "connector.configure" || endpoint === "configure") {
    const baseUrl =
      typeof payload.baseUrl === "string" ? payload.baseUrl.trim() : "";
    const deviceId =
      typeof payload.deviceId === "string" && payload.deviceId.trim()
        ? payload.deviceId.trim()
        : `xrk-${Date.now()}`;
    const token =
      typeof payload.token === "string" ? payload.token : store.config?.token;
    const next: OfficeStore = {
      configured: Boolean(baseUrl),
      connected: false,
      state: baseUrl ? "idle" : "unconfigured",
      config: baseUrl
        ? {
            baseUrl,
            deviceId,
            maxConcurrency: Number(payload.maxConcurrency ?? 1),
            heartbeatSeconds: Number(payload.heartbeatSeconds ?? 30),
            ...(token ? { token } : {}),
          }
        : null,
    };
    const saved = OFFICE_STORE.write(home, next);
    return statusPayload(saved.data, home, saved.revision);
  }

  if (endpoint === "connector.reconnect" || endpoint === "reconnect") {
    const heartbeat = readConnectorHeartbeat(home);
    const saved = OFFICE_STORE.patch(home, (current) => ({
      ...current,
      connected:
        current.configured &&
        heartbeat != null &&
        Date.now() - heartbeat < 120_000,
      state: current.configured ? "connecting" : "unconfigured",
    }));
    return statusPayload(saved.data, home, saved.revision);
  }

  if (endpoint === "connector.test" || endpoint === "test") {
    const heartbeat = readConnectorHeartbeat(home);
    return {
      ok: store.configured,
      reachable:
        store.configured &&
        heartbeat != null &&
        Date.now() - heartbeat < 120_000,
      adapter: DSH_COMPAT_ADAPTER,
    };
  }

  if (endpoint === "connector.remove" || endpoint === "remove") {
    const saved = OFFICE_STORE.write(home, {
      configured: false,
      connected: false,
      state: "unconfigured",
      config: null,
    });
    return statusPayload(saved.data, home, saved.revision);
  }

  return honestReady({ endpoint });
}
