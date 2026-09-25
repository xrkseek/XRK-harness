/**
 * DSH-aligned settings namespace schemas + composition bases for Face `settings.describe`.
 */
import Schema from "@xrkseek/schemastery";
import type { FaceSchemaEnvelope } from "./face-schema.js";
import {
  FACE_LOCALE_SCHEMA,
  FACE_MCP_SCHEMA,
  FACE_ONBOARDING_SCHEMA,
  FACE_PERMISSION_SCHEMA,
  FACE_THEME_SCHEMA,
  FACE_FONT_SIZE_DEFAULT,
} from "./face-schema.js";
import { HOST_CLI_PRESET_IDS } from "./presets-catalog.js";

/** Wire protocols the models settings UI may offer (custom / gateway routes). */
const PI_AI_PROTOCOLS = [
  "openai-chat",
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate",
] as const;

export const DEFAULT_DEEPSEEK_MODELS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly inputModalities: Array<"text" | "image">;
}> = [
  {
    id: "deepseek-flash",
    name: "DeepSeek-V41-Flash",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    inputModalities: ["text", "image"],
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    inputModalities: ["text"],
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    inputModalities: ["text"],
  },
  {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek V4 Flash Vision Exp",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    inputModalities: ["text", "image"],
  },
];

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
      inputModalities: Schema.array(Schema.union(["text", "image"])).min(1),
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
  default: Schema.union([...HOST_CLI_PRESET_IDS]),
});

const BashConfig = Schema.object({
  timeoutMs: Schema.number().step(1).min(1),
  /** Per-stream capture cap (DSH bash-local default 64_000). */
  maxOutputBytes: Schema.number().step(1).min(1).default(64_000),
  /**
   * Foreground bash yield (ms): return early with job id while the process
   * keeps running. Codex unified_exec clamps 250–30_000.
   */
  foregroundYieldMs: Schema.number().step(1).min(250).max(30_000).default(30_000),
});

const AgentLoopConfig = Schema.object({
  maxParallelToolCalls: Schema.number().step(1).min(1),
  /** Max LLM steps per user turn (tool rounds). Harness/server default 32. */
  maxSteps: Schema.number().step(1).min(1).default(32),
  /** Resume automatically when a model stops at its output token cap. */
  autoContinueOnMaxTokens: Schema.boolean().default(false),
  /** Maximum automatic continuations per turn (independent of maxSteps). */
  autoContinueMaxRounds: Schema.number().step(1).min(1).max(10).default(2),
  /**
   * DSH toolOrder: tool name list with exactly one `' '` rest marker.
   * Empty / omit → lexicographic wire order. Editable via Settings → Plugins.
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
  /**
   * Soft context budget (messages + tool schemas). Exceed → strategy
   * (`compactionStrategy`) → fail-closed. Default 100_000.
   */
  maxRequestTokens: Schema.number().step(1_000).min(8_000).default(100_000),
  /** Tokens kept as recent tail after auto-compact. */
  keepTokens: Schema.number().step(1_000).min(2_000).default(24_000),
  /** Soft ceiling = maxRequestTokens − bufferTokens. */
  bufferTokens: Schema.number().step(500).min(0).default(4_000),
  /**
   * Soft-budget strategy family (DSH prune→summary posture).
   * `prune-summary` (default) · `prune-only` · `summary-only` · `off`.
   */
  compactionStrategy: Schema.union([
    "prune-summary",
    "prune-only",
    "summary-only",
    "off",
  ]).default("prune-summary"),
  /**
   * Thin Guardian review fragment at turn-start (advisory; not an LLM approval
   * gate). Default on with harness context-fragments.
   */
  guardianFragments: Schema.boolean().default(true),
  /**
   * Spill plain-text tool results over this UTF-8 byte ceiling (DSH spill-policy).
   * `0` disables spill (not recommended). Default 64_000.
   */
  toolResultMaxInlineBytes: Schema.number().step(1_000).min(0).default(64_000),
  /**
   * Max subagent nesting depth (parent=0). Hermes-style tighter default than
   * historical 3. Badge ceilings (e.g. Shallow=1) still apply via min().
   */
  maxSubagentDepth: Schema.number().step(1).min(1).max(3).default(2),
  /**
   * Max concurrently draining direct children under one parent.
   */
  maxActiveSubagents: Schema.number().step(1).min(1).max(16).default(2),
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

/** Session telemetry: Settings SoT; `XRK_TELEMETRY` remains CI bypass. */
const SessionTelemetryConfig = Schema.object({
  mode: Schema.union(["off", "memory", "otlp"]).default("off"),
  /** OTLP/HTTP logs endpoint when mode is `otlp`. */
  endpoint: Schema.string(),
});

/**
 * Exec sandbox backend (Plugins card). Env `XRK_SANDBOX_*` remains CI bypass.
 * Helper path / bins stay env-only (machine-local).
 */
const SandboxConfig = Schema.object({
  backend: Schema.union(["workspace", "docker", "bwrap", "windows"]).default(
    "workspace",
  ),
  dockerImage: Schema.string(),
  dockerNetwork: Schema.union(["none", "bridge"]).default("none"),
  windowsMode: Schema.union([
    "workspace-write",
    "read-only",
    "danger-full-access",
  ]).default("workspace-write"),
});

/**
 * Desktop computer-use (Plugins card). Env `XRK_COMPUTER_USE` remains CI bypass.
 * Background helper path uses Credentials `XRK_COMPUTER_USE_BACKGROUND`.
 */
const ComputerUseConfig = Schema.object({
  mode: Schema.union(["off", "uia", "background"]).default("off"),
});

/**
 * Page-level browser_* (Plugins card): HTTP snapshot or Chrome DevTools.
 * Non-empty `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL` remains CI bypass.
 */
const BrowserConfig = Schema.object({
  mode: Schema.union(["http", "cdp"]).default("http"),
  cdpUrl: Schema.string().default(""),
});

/**
 * Host cron ticker master switch (Plugins card).
 * Env `XRK_CRON=0` remains CI bypass (force off).
 */
const CronConfig = Schema.object({
  enabled: Schema.boolean().default(true),
});

/**
 * Voice Host (Plugins card). Env `XRK_VOICE` remains CI bypass.
 * API key via Credentials `XRK_VOICE_OPENAI_KEY`.
 */
const VoiceConfig = Schema.object({
  mode: Schema.union(["off", "openai"]).default("off"),
  baseUrl: Schema.string().default(""),
});

/**
 * Image generation (Plugins card). Env `XRK_IMAGE_GEN` remains CI bypass.
 * API key via Credentials `XRK_IMAGE_GEN_OPENAI_KEY`.
 */
const ImageGenConfig = Schema.object({
  mode: Schema.union(["off", "openai"]).default("off"),
  baseUrl: Schema.string().default(""),
  model: Schema.string().default(""),
});

/**
 * Video generation (Plugins card). Env `XRK_VIDEO_GEN` remains CI bypass.
 * API key via Credentials `XRK_VIDEO_GEN_OPENAI_KEY`.
 */
const VideoGenConfig = Schema.object({
  mode: Schema.union(["off", "openai"]).default("off"),
  baseUrl: Schema.string().default(""),
  model: Schema.string().default(""),
});

/**
 * Video analysis / understanding (Plugins card). Env `XRK_VIDEO_ANALYZE` remains CI bypass.
 * API key via Credentials `XRK_VIDEO_ANALYZE_OPENAI_KEY`. Distinct from browser_vision.
 */
const VideoAnalyzeConfig = Schema.object({
  mode: Schema.union(["off", "openai"]).default("off"),
  baseUrl: Schema.string().default(""),
  model: Schema.string().default(""),
});

/**
 * Curated MEMORY.md / USER.md (Plugins card).
 * Env `XRK_CURATED_MEMORY=0` remains CI bypass (force off).
 */
const CuratedMemoryConfig = Schema.object({
  enabled: Schema.boolean().default(true),
  /**
   * Session-end Phase2 LLM extract into MEMORY.md (needs a resolvable session LLM).
   * Env `XRK_CURATED_MEMORY_PHASE2=1` also enables.
   */
  phase2Llm: Schema.boolean().default(false),
});

/**
 * A2A inbound public routes (Plugins card).
 * Non-empty `XRK_A2A_INBOUND` remains CI bypass (`0` force off).
 * No SSE / tasks CRUD — Agent Card + message/send → Face inject only.
 */
const A2aInboundConfig = Schema.object({
  /** Enable Agent Card + POST /a2a message/send (Face session inject). */
  enabled: Schema.boolean().default(false),
  /** Pin Face session id; empty → a2a-<contextId>. */
  sessionId: Schema.string().default(""),
  /** Wait for assistant body (ms); 0 = default 120000. */
  timeoutMs: Schema.number().step(1000).min(0).max(600_000).default(0),
});

/**
 * Auto-review HTTP classifier (Plugins → Advanced).
 * Token via Credentials `XRK_AUTO_REVIEW_CLASSIFIER_TOKEN`.
 * Non-empty `XRK_AUTO_REVIEW_CLASSIFIER_URL` remains CI bypass.
 */
const AutoReviewConfig = Schema.object({
  /** POST endpoint for verdict JSON; empty = heuristic. */
  classifierUrl: Schema.string().default(""),
});

/**
 * External vector memory sidecar (Plugins → Advanced).
 * Token via Credentials `XRK_MEMORY_EMBED_TOKEN`.
 * Non-empty `XRK_MEMORY_EMBED_URL` remains CI bypass.
 */
const MemoryEmbedConfig = Schema.object({
  /** HTTP base for sidecar /search · /health; empty = embedded host only. */
  url: Schema.string().default(""),
  /** Optional collection / index name passed to sidecar /search. */
  collection: Schema.string().default(""),
  /** OpenAI-compatible embeddings base (…/v1 or …/v1/embeddings). */
  embeddingsUrl: Schema.string().default(""),
  /** Embeddings model id (default text-embedding-3-small when URL set via env). */
  embeddingsModel: Schema.string().default(""),
});

/**
 * External subagent runtimes (Plugins card): ACP / Codex app-server / Claude Code.
 * Non-empty `XRK_ACP_AGENT` / `XRK_CODEX_APP_SERVER` / `XRK_CLAUDE_CODE` remain CI bypass.
 */
const ExternalAgentConfig = Schema.object({
  /** Spawn command for `runtime=acp` (e.g. `xrkh acp`). Empty = require env. */
  acpAgent: Schema.string().default(""),
  /** Spawn command for `runtime=app-server` (default `codex app-server` when empty). */
  codexAppServer: Schema.string().default(""),
  /** Spawn command for `runtime=claude-code` (default `claude` when empty; Host adds `-p`). */
  claudeCode: Schema.string().default(""),
});

/**
 * SSH remote workspace (General 「远程」). Empty host+workspace = local.
 * Non-empty `XRK_SSH_HOST` remains CI bypass (env wins over product).
 * Host builds the SSH world at spawn — restart required.
 */
const SshRemoteConfig = Schema.object({
  host: Schema.string().default(""),
  /** Absolute remote cwd (POSIX `/…`). */
  workspace: Schema.string().default(""),
  user: Schema.string().default(""),
  port: Schema.number().step(1).min(1).max(65535).default(22),
  /** Local path to OpenSSH identity file (not the key material). */
  keyPath: Schema.string().default(""),
});

export const DEFAULT_WORKSPACE_INJECT_MAX_CHARS = 32_000;

const WorkspaceInjectConfig = Schema.object({
  /** Total character budget for rules + skills catalog inject (per turn). */
  injectMaxChars: Schema.number()
    .step(1000)
    .min(4_000)
    .max(128_000)
    .default(DEFAULT_WORKSPACE_INJECT_MAX_CHARS),
});

const UiConversationConfig = Schema.object({
  busyEnter: Schema.union(["queue", "steer"]),
});

/**
 * Settings base for `llm-pi-ai`: zero-config routes only.
 * Registry brands surface via `llm.providers` as the Settings add directory.
 */
function buildPiAiCatalogBase(): Record<string, unknown> {
  return {
    providers: {
      ollama: {
        displayName: "Ollama（OpenAI 兼容端口）",
        api: "openai-chat",
        baseURL: "http://127.0.0.1:11434/v1",
      },
    },
  };
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
      base: { preference: "system", fontSize: FACE_FONT_SIZE_DEFAULT },
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
      base: { provider: "deepseek", model: "deepseek-flash" },
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
      base: { maxOutputBytes: 64_000, foregroundYieldMs: 30_000 },
      applies: "live",
    },
    {
      ns: "agent-loop",
      schema: schemasteryJson(AgentLoopConfig) as FaceSchemaEnvelope,
      base: {
        maxSteps: 32,
        autoContinueOnMaxTokens: false,
        autoContinueMaxRounds: 2,
        toolSettle: "parallel",
        llmRetryMaxRetries: 5,
        maxRequestTokens: 100_000,
        keepTokens: 24_000,
        bufferTokens: 4_000,
        compactionStrategy: "prune-summary",
        guardianFragments: true,
        toolResultMaxInlineBytes: 64_000,
        maxSubagentDepth: 2,
        maxActiveSubagents: 2,
      },
      applies: "live",
    },
    {
      ns: "web-search",
      schema: schemasteryJson(WebSearchConfig) as FaceSchemaEnvelope,
      base: { provider: "auto" },
      applies: "live",
    },
    {
      ns: "session-telemetry",
      schema: schemasteryJson(SessionTelemetryConfig) as FaceSchemaEnvelope,
      base: { mode: "off" },
      // Sink wraps the store at composition create; Host restart picks up changes.
      applies: "restart",
    },
    {
      ns: "sandbox",
      schema: schemasteryJson(SandboxConfig) as FaceSchemaEnvelope,
      base: {
        backend: "workspace",
        dockerNetwork: "none",
        windowsMode: "workspace-write",
      },
      // createSandboxStack + wrap-guard rebuild on agent invalidate.
      applies: "live",
    },
    {
      ns: "computer-use",
      schema: schemasteryJson(ComputerUseConfig) as FaceSchemaEnvelope,
      base: { mode: "off" },
      // Provider rebuilds with tools on agent invalidate.
      applies: "live",
    },
    {
      ns: "browser",
      schema: schemasteryJson(BrowserConfig) as FaceSchemaEnvelope,
      base: { mode: "http", cdpUrl: "" },
      // createBrowserSession rebuilds on agent invalidate.
      applies: "live",
    },
    {
      ns: "cron",
      schema: schemasteryJson(CronConfig) as FaceSchemaEnvelope,
      base: { enabled: true },
      // Host start/stop ticker + invalidateAgents for cronjob tool.
      applies: "live",
    },
    {
      ns: "voice",
      schema: schemasteryJson(VoiceConfig) as FaceSchemaEnvelope,
      base: { mode: "off", baseUrl: "" },
      applies: "live",
    },
    {
      ns: "image-gen",
      schema: schemasteryJson(ImageGenConfig) as FaceSchemaEnvelope,
      base: { mode: "off", baseUrl: "", model: "" },
      applies: "live",
    },
    {
      ns: "video-gen",
      schema: schemasteryJson(VideoGenConfig) as FaceSchemaEnvelope,
      base: { mode: "off", baseUrl: "", model: "" },
      applies: "live",
    },
    {
      ns: "video-analyze",
      schema: schemasteryJson(VideoAnalyzeConfig) as FaceSchemaEnvelope,
      base: { mode: "off", baseUrl: "", model: "" },
      applies: "live",
    },
    {
      ns: "curated-memory",
      schema: schemasteryJson(CuratedMemoryConfig) as FaceSchemaEnvelope,
      base: { enabled: true, phase2Llm: false },
      // memory tool + frozen system block rebuild on agent invalidate.
      applies: "live",
    },
    {
      ns: "a2a-inbound",
      schema: schemasteryJson(A2aInboundConfig) as FaceSchemaEnvelope,
      base: { enabled: false, sessionId: "", timeoutMs: 0 },
      // Public routes re-read product each request (no Host restart).
      applies: "live",
    },
    {
      ns: "auto-review",
      schema: schemasteryJson(AutoReviewConfig) as FaceSchemaEnvelope,
      base: { classifierUrl: "" },
      // Classifier resolves per /auto-review/classify (Host injects product).
      applies: "live",
    },
    {
      ns: "memory-embed",
      schema: schemasteryJson(MemoryEmbedConfig) as FaceSchemaEnvelope,
      base: { url: "", collection: "", embeddingsUrl: "", embeddingsModel: "" },
      // Sidecar resolves per embedding.search / status (Host injects product).
      applies: "live",
    },
    {
      ns: "external-agent",
      schema: schemasteryJson(ExternalAgentConfig) as FaceSchemaEnvelope,
      base: { acpAgent: "", codexAppServer: "", claudeCode: "" },
      // Launch command resolves per subagent external turn.
      applies: "live",
    },
    {
      ns: "ssh-remote",
      schema: schemasteryJson(SshRemoteConfig) as FaceSchemaEnvelope,
      base: {
        host: "",
        workspace: "",
        user: "",
        port: 22,
        keyPath: "",
      },
      // SSH execution world is fixed at Host spawn (before Face).
      applies: "restart",
    },
    {
      ns: "workspace-inject",
      schema: schemasteryJson(WorkspaceInjectConfig) as FaceSchemaEnvelope,
      base: { injectMaxChars: DEFAULT_WORKSPACE_INJECT_MAX_CHARS },
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
