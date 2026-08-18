import { discoverOpenAiChatModels } from "@xrkseek/llm-registry";
import { FACE_AGENT_PRESETS, FACE_AGENT_PRESET_IDS } from "../presets-catalog.js";
import { readSessionAttachment } from "../session-attachment.js";
import { asRecord, type FaceHandler } from "./types.js";

export const agentPresetList: FaceHandler = async (runtime) => {
  const defaultId = runtime.defaultAgentPreset ?? "minimal";
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
  const routable = new Map(
    runtime.registry.listRoutable().map((r) => [r.id, r]),
  );
  const providers = runtime.registry.listBrands().map((b) => ({
    provider: b.id,
    displayName: b.displayName,
    settingsNs: "llm",
    settingsPath: [] as string[],
    active: routable.get(b.id)?.active ?? false,
  }));
  return { ok: true, value: { providers } };
};

export const llmModels: FaceHandler = async (runtime) => {
  const groups = runtime.registry
    .listBrands()
    .filter((b) => b.baseUrl || b.id === "ollama")
    .map((b) => ({
      id: b.id,
      name: b.displayName,
      models: [
        {
          id: b.defaultModel ?? "default",
          name: b.defaultModel ?? "default",
        },
      ],
    }));
  return { ok: true, value: { groups, failures: [] } };
};

/** Namespaces this Host can interrogate (openai-chat GET /models). */
const DISCOVERY_NS = new Set(["llm", "llm-pi-ai"]);

function resolveDiscoveryBaseUrl(
  runtime: Parameters<FaceHandler>[0],
  provider: string | undefined,
  baseURL: string | undefined,
): { baseUrl?: string; authMode?: "bearer" | "api-key" } {
  if (provider) {
    try {
      const binding = runtime.registry.resolve({ provider });
      return {
        ...(baseURL || binding.baseUrl
          ? { baseUrl: baseURL ?? binding.baseUrl }
          : {}),
        authMode: binding.authMode,
      };
    } catch {
      return baseURL ? { baseUrl: baseURL } : {};
    }
  }
  return baseURL ? { baseUrl: baseURL } : {};
}

function resolveDiscoveryKey(
  runtime: Parameters<FaceHandler>[0],
  provider: string | undefined,
  apiKey: string | undefined,
): string | undefined {
  const typed = apiKey?.trim();
  if (typed) return typed;
  if (!provider) return undefined;
  const vault = runtime.credentials.peek(`llm.${provider}`);
  if (vault?.trim()) return vault.trim();
  const brand = runtime.registry.listBrands().find((b) => b.id === provider);
  const envName = brand?.apiKeyEnv;
  if (!envName) return undefined;
  const fromEnv = process.env[envName]?.trim();
  return fromEnv || undefined;
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

