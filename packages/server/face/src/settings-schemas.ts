/**
 * DSH-aligned settings namespace schemas + composition bases for Face `settings.describe`.
 */
import {
  OPENAI_CHAT_BRANDS,
  R1_PROTOCOL_BRANDS,
} from "@xrkseek/llm-registry";
import Schema from "@xrkseek/schemastery";
import type { FaceSchemaEnvelope } from "./face-schema.js";
import {
  FACE_LOCALE_SCHEMA,
  FACE_MCP_SCHEMA,
  FACE_ONBOARDING_SCHEMA,
  FACE_PERMISSION_SCHEMA,
  FACE_THEME_SCHEMA,
} from "./face-schema.js";

/** Wire protocols the models settings UI may offer (custom / gateway routes). */
const PI_AI_PROTOCOLS = [
  "openai-chat",
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate",
] as const;

export const DEFAULT_DEEPSEEK_MODELS = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
] as const;

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role("credential-ref"),
  baseURL: Schema.string(),
  reasoningEffort: Schema.union(["off", "low", "high", "max"]),
  defaultContextWindow: Schema.number().step(1).min(1),
  maxTokens: Schema.number().step(1).min(1),
  models: Schema.array(
    Schema.object({
      id: Schema.string().required(),
      name: Schema.string(),
      description: Schema.string(),
      contextWindow: Schema.number().step(1).min(1),
      maxTokens: Schema.number().step(1).min(1),
    }),
  ).default([...DEFAULT_DEEPSEEK_MODELS]),
});

const PiAiProvider = Schema.object({
  apiKeyEnv: Schema.string().role("credential-ref"),
  baseURL: Schema.string(),
  api: Schema.union([...PI_AI_PROTOCOLS]),
  displayName: Schema.string(),
  reasoning: Schema.union([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]),
  headers: Schema.dict(Schema.string()),
  models: Schema.array(
    Schema.object({
      id: Schema.string().required(),
      name: Schema.string(),
      contextWindow: Schema.number().step(1).min(1),
      maxTokens: Schema.number().step(1).min(1),
    }),
  ),
});

const PiAiConfig = Schema.object({
  providers: Schema.dict(PiAiProvider),
});

const AgentDefaultModelConfig = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  reasoningEffort: Schema.union([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]),
});

const AgentPresetsConfig = Schema.object({
  default: Schema.union(["minimal", "harness", "server"]),
});

const BashConfig = Schema.object({
  timeoutMs: Schema.number().step(1).min(1),
  maxOutputBytes: Schema.number().step(1).min(1),
});

const AgentLoopConfig = Schema.object({
  maxParallelToolCalls: Schema.number().step(1).min(1),
  /** Max LLM steps per user turn (tool rounds). Harness/server default 32. */
  maxSteps: Schema.number().step(1).min(1).default(32),
  /**
   * DSH toolOrder: tool name list with exactly one `' '` rest marker.
   * Empty / omit → lexicographic wire order. Edited via settings.yaml for now.
   */
  toolOrder: Schema.array(Schema.string()),
  /**
   * Tool settle mode. `parallel` (default) uses `isConcurrencySafe` barriers;
   * `serial` forces exclusive execution for every call.
   */
  toolSettle: Schema.union(["parallel", "serial"]).default("parallel"),
  /**
   * Max provider retries within one LLM step (`0` disables).
   * Omit → kernel default (5).
   */
  llmRetryMaxRetries: Schema.number().step(1).min(0).default(5),
});

const WebSearchConfig = Schema.object({
  provider: Schema.union([
    "auto",
    "tavily",
    "brave",
    "parallel-free",
    "duckduckgo",
  ]),
  region: Schema.string(),
});

const UiConversationConfig = Schema.object({
  busyEnter: Schema.union(["queue", "steer"]),
});

/** Shipped openai-chat + R1 protocol catalog (excludes DeepSeek → `llm-deepseek`). */
function buildPiAiCatalogBase(): Record<string, unknown> {
  const providers: Record<string, Record<string, unknown>> = {};
  for (const brand of [...OPENAI_CHAT_BRANDS, ...R1_PROTOCOL_BRANDS]) {
    if (brand.id === "deepseek") continue;
    const profile: Record<string, unknown> = {
      displayName: brand.displayName,
      api: brand.protocol,
    };
    if (brand.apiKeyEnv) profile.apiKeyEnv = brand.apiKeyEnv;
    if (brand.baseUrl) profile.baseURL = brand.baseUrl;
    providers[brand.id] = profile;
  }
  return { providers };
}

export interface FaceSettingsNamespaceSpec {
  readonly ns: string;
  readonly schema: FaceSchemaEnvelope | ReturnType<(typeof Schema)["object"]>;
  readonly base: Record<string, unknown>;
  readonly applies: "live" | "restart";
}

function schemasteryJson(
  schema: ReturnType<(typeof Schema)["object"]>,
): unknown {
  return JSON.parse(JSON.stringify(schema.toJSON()));
}

export const FACE_PRODUCT_SETTINGS_NAMESPACES: readonly FaceSettingsNamespaceSpec[] =
  [
    {
      ns: "ui-onboarding",
      schema: FACE_ONBOARDING_SCHEMA,
      base: {},
      applies: "live",
    },
    {
      ns: "locale",
      schema: FACE_LOCALE_SCHEMA,
      base: { preference: "en" },
      applies: "live",
    },
    {
      ns: "ui-theme",
      schema: FACE_THEME_SCHEMA,
      base: { preference: "system" },
      applies: "live",
    },
    {
      ns: "permission",
      schema: FACE_PERMISSION_SCHEMA,
      base: { defaultPreset: "workspace-write" },
      applies: "live",
    },
    {
      ns: "agent-default-model",
      schema: schemasteryJson(AgentDefaultModelConfig) as FaceSchemaEnvelope,
      base: { provider: "deepseek", model: "deepseek-v4-flash" },
      applies: "live",
    },
    {
      ns: "agent-presets",
      schema: schemasteryJson(AgentPresetsConfig) as FaceSchemaEnvelope,
      base: { default: "harness" },
      applies: "live",
    },
    {
      ns: "llm-deepseek",
      schema: schemasteryJson(DeepSeekConfig) as FaceSchemaEnvelope,
      base: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        baseURL: "https://api.deepseek.com",
        defaultContextWindow: 1_000_000,
        maxTokens: 384_000,
        models: [...DEFAULT_DEEPSEEK_MODELS],
      },
      applies: "live",
    },
    {
      ns: "llm-pi-ai",
      schema: schemasteryJson(PiAiConfig) as FaceSchemaEnvelope,
      base: buildPiAiCatalogBase(),
      applies: "live",
    },
    {
      ns: "bash",
      schema: schemasteryJson(BashConfig) as FaceSchemaEnvelope,
      base: {},
      applies: "live",
    },
    {
      ns: "agent-loop",
      schema: schemasteryJson(AgentLoopConfig) as FaceSchemaEnvelope,
      base: { maxSteps: 32, toolSettle: "parallel", llmRetryMaxRetries: 5 },
      applies: "live",
    },
    {
      ns: "web-search",
      schema: schemasteryJson(WebSearchConfig) as FaceSchemaEnvelope,
      base: { provider: "auto" },
      applies: "live",
    },
    {
      ns: "ui-conversation",
      schema: schemasteryJson(UiConversationConfig) as FaceSchemaEnvelope,
      base: { busyEnter: "queue" },
      applies: "live",
    },
    {
      ns: "mcp",
      schema: FACE_MCP_SCHEMA,
      base: { servers: [], allowConnect: false },
      applies: "live",
    },
  ];

export function schemaEnvelopeOf(
  spec: FaceSettingsNamespaceSpec,
): FaceSchemaEnvelope | unknown {
  return spec.schema;
}
