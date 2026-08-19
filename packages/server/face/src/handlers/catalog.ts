import { discoverOpenAiChatModels } from "@xrkseek/llm-registry";
import { FACE_AGENT_PRESETS, FACE_AGENT_PRESET_IDS } from "../presets-catalog.js";
import { resolveDefaultAgentPreset } from "../settings-document.js";
import { buildFaceModelCatalog, routeServed } from "../model-catalog.js";
import {
  readProviderApiKey,
  readProviderRoute,
} from "../llm-provider-context.js";
import { readSessionAttachment } from "../session-attachment.js";
import { asRecord, type FaceHandler } from "./types.js";
import { publishRemoteEvent } from "../remote-event.js";

export const agentPresetList: FaceHandler = async (runtime) => {
  const defaultId = resolveDefaultAgentPreset(runtime);
  return {
    ok: true,
    value: {
      presets: FACE_AGENT_PRESETS.map((p) => ({
        id: p.id,
        trust: "system" as const,
        isDefault: p.id === defaultId,
        name: p.displayName,
        description: p.description,
      })),
      authorable: false,
      hasDocument: false,
    },
  };
};

export const agentPresetRead: FaceHandler = async (_runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const agentPreset = String(p.agentPreset ?? "").trim();
  if (!agentPreset) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "agentPreset required" },
    };
  }
  const info = FACE_AGENT_PRESETS.find((x) => x.id === agentPreset);
  if (!info) {
    return {
      ok: false,
      error: {
        code: "agent-preset-not-found",
        message: `unknown agentPreset: ${agentPreset}`,
        details: {
          agentPreset,
          available: [...FACE_AGENT_PRESET_IDS],
        },
      },
    };
  }
  const content = [
    `# ${info.displayName}`,
    "",
    info.description,
    "",
    `id: ${info.id}`,
    "trust: system",
    "authorable: false",
  ].join("\n");
  return {
    ok: true,
    value: {
      agentPreset: info.id,
      trust: "system" as const,
      content,
      name: info.displayName,
      description: info.description,
    },
  };
};

export const agentPresetSelect: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const agentPreset = String(p.agentPreset ?? "");
  if (!sessionId || !agentPreset) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId and agentPreset required",
      },
    };
  }
  if (!FACE_AGENT_PRESET_IDS.has(agentPreset)) {
    return {
      ok: false,
      error: {
        code: "agent-preset-not-found",
        message: `unknown agentPreset: ${agentPreset}`,
      },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }
  runtime.sessionAgentPresets.set(sessionId, agentPreset);
  await runtime.invalidateAgent?.(sessionId);
  publishRemoteEvent(runtime.bus, "agent-preset/selected", [
    sessionId,
    agentPreset,
  ]);
  return { ok: true, value: { sessionId, agentPreset } };
};

/** DSH UI disables copy when `authorable: false`; if still called, use the closed error. */
export const agentPresetReadOnly: FaceHandler = async (_runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const agentPreset = String(p.agentPreset ?? "").trim() || "unknown";
  return {
    ok: false,
    error: {
      code: "agent-preset-read-only",
      message: "agent presets are not authorable on this host",
      details: { agentPreset, reason: "authorable: false" },
    },
  };
};

export const llmProviders: FaceHandler = async (runtime) => {
  const providers = runtime.registry.listBrands().map((b) => {
    if (b.id === "deepseek") {
      return {
        provider: "deepseek-official",
        displayName: b.displayName,
        settingsNs: "llm-deepseek",
        settingsPath: [] as string[],
        active: routeServed(runtime, b.id),
        declared: false,
      };
    }
    return {
      provider: b.id,
      displayName: b.displayName,
      settingsNs: "llm-pi-ai",
      settingsPath: ["providers", b.id],
      active: routeServed(runtime, b.id),
      declared: false,
    };
  });
  return { ok: true, value: { providers } };
};

export const llmModels: FaceHandler = async (runtime) => {
  return { ok: true, value: buildFaceModelCatalog(runtime) };
};

/** Namespaces this Host can interrogate (openai-chat GET /models). */
const DISCOVERY_NS = new Set(["llm-deepseek", "llm-pi-ai"]);

function resolveDiscoveryBaseUrl(
  runtime: Parameters<FaceHandler>[0],
  provider: string | undefined,
  baseURL: string | undefined,
): { baseUrl?: string; authMode?: "bearer" | "api-key" } {
  if (provider) {
    const route = readProviderRoute(runtime, provider);
    try {
      const binding = runtime.registry.resolve({
        provider,
        ...(route.baseUrl ? { baseUrl: route.baseUrl } : {}),
        ...(baseURL ? { baseUrl: baseURL } : {}),
      });
      return {
        ...(binding.baseUrl ? { baseUrl: binding.baseUrl } : {}),
        authMode: binding.authMode,
      };
    } catch {
      const baseUrl = baseURL ?? route.baseUrl;
      return baseUrl ? { baseUrl } : {};
    }
  }
  return baseURL ? { baseUrl: baseURL } : {};
}

function resolveDiscoveryKey(
  runtime: Parameters<FaceHandler>[0],
  provider: string | undefined,
  apiKey: string | undefined,
): string | undefined {
  if (!provider) {
    const typed = apiKey?.trim();
    return typed || undefined;
  }
  try {
    return readProviderApiKey(runtime, provider, apiKey).apiKey;
  } catch {
    return undefined;
  }
}

export const llmDiscoverModels: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const settingsNs = String(p.settingsNs ?? "").trim();
  const providerRaw =
    typeof p.provider === "string" ? p.provider.trim() : "";
  const provider = providerRaw || undefined;
  const baseURL =
    typeof p.baseURL === "string" && p.baseURL.trim()
      ? p.baseURL.trim()
      : undefined;
  const api = typeof p.api === "string" ? p.api.trim() : undefined;
  const apiKey = typeof p.apiKey === "string" ? p.apiKey : undefined;

  if (!DISCOVERY_NS.has(settingsNs)) {
    return {
      ok: false,
      error: {
        code: "model-discovery-failed",
        message: `no model discovery is registered for "${settingsNs}"`,
        details: { settingsNs },
      },
    };
  }
  if (!provider && !baseURL) {
    return {
      ok: false,
      error: {
        code: "model-discovery-failed",
        message: "model discovery needs a provider route or a baseURL",
        details: { settingsNs },
      },
    };
  }

  const resolved = resolveDiscoveryBaseUrl(runtime, provider, baseURL);
  const key = resolveDiscoveryKey(runtime, provider, apiKey);

  try {
    const models = await discoverOpenAiChatModels({
      ...(provider ? { provider } : {}),
      ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
      ...(api ? { api } : {}),
      ...(key ? { apiKey: key } : {}),
      ...(resolved.authMode ? { authMode: resolved.authMode } : {}),
    });
    return { ok: true, value: { models } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        code: "model-discovery-failed",
        message,
        details: {
          settingsNs,
          ...(resolved.baseUrl ? { baseURL: resolved.baseUrl } : {}),
        },
      },
    };
  }
};

export const sessionAttachment: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const attachmentId = String(p.attachmentId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.attachments) {
    return {
      ok: false,
      error: {
        code: "attachment-unavailable",
        message: "attachment store not configured",
      },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "not-found", message: "session not found" },
    };
  }
  const events = runtime.store.get(sessionId).events;
  const result = await readSessionAttachment({
    events,
    attachments: runtime.attachments,
    attachmentId,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: { code: result.code, message: result.message },
    };
  }
  return { ok: true, value: result.value };
};

