/**
 * DSH-aligned settings namespace schemas + composition bases for Face `settings.describe`.
 */
import Schema from "@xrkseek/schemastery";
import { resolveXrkHome } from "@xrkseek/server-config";
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
import {
  MEMBER_COLORS,
  MEMBER_KITS,
  MEMBER_SHAPES,
} from "./agent-roster-store.js";

/** Product home is the default extra-writable root (Settings → Permissions). */
function permissionSettingsBase(): {
  defaultPreset: "workspace-write";
  extraWritableRoots: string[];
} {
  return {
    defaultPreset: "workspace-write",
    extraWritableRoots: [resolveXrkHome()],
  };
}

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
  /** Soft compact ceiling (orthogonal to contextWindow). */
  readonly softBudgetMaxTokens: number;
  /** Omitted → derived from softBudgetMaxTokens by `resolveSoftBudgetTokens`. */
  readonly softBudgetKeepTokens: number;
  readonly softBudgetBufferTokens: number;
  readonly inputModalities: Array<"text" | "image">;
}> = [
  {
    id: "deepseek-flash",
    name: "DeepSeek-V41-Flash",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    softBudgetMaxTokens: 300_000,
    softBudgetKeepTokens: 24_000,
    softBudgetBufferTokens: 4_000,
    inputModalities: ["text", "image"],
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    softBudgetMaxTokens: 300_000,
    softBudgetKeepTokens: 24_000,
    softBudgetBufferTokens: 4_000,
    inputModalities: ["text"],
  },
];

const DeepSeekCatalogModelSchema = Schema.object({
  id: Schema.string().required(),
  name: Schema.string(),
  description: Schema.string(),
  contextWindow: Schema.number().step(1).min(1),
  maxTokens: Schema.number().step(1).min(1),
  /**
   * Soft-budget ceiling; omit → floor(contextWindow × 90%) when window ≥8k.
   * step(1) — Codex 90% yields values like 235929 / 58982; step(1000) blocked
   * every Models mutate (e.g. create provider) once any catalog row stored one.
   */
  softBudgetMaxTokens: Schema.number().step(1).min(1),
  /** Optional overrides; absent → `resolveSoftBudgetTokens` derives them. */
  softBudgetKeepTokens: Schema.number().step(1).min(1),
  softBudgetBufferTokens: Schema.number().step(1).min(0),
  /** Live sessions on this route; omit → agent-loop.maxConcurrentModelSessions. */
  maxConcurrentSessions: Schema.number().step(1).min(1).max(64),
  // Empty = unset (UI treats as text); do not use .min(1) — legacy rows
  // with `[]` must not block unrelated settings.mutate (community LLM sync).
  inputModalities: Schema.array(Schema.union(["text", "image"])),
  /**
   * Optional HTTP(S) proxy for this model only (beats provider `proxy`).
   * Empty / `direct` / `none` → no proxy; omit → inherit provider then env.
   */
  proxy: Schema.string(),
});

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role("credential-ref"),
  baseURL: Schema.string(),
  /** Optional HTTP(S) proxy for every model on this provider (model `proxy` wins). */
  proxy: Schema.string(),
  reasoningEffort: Schema.union(["off", "low", "high", "max"]),
  defaultContextWindow: Schema.number().step(1).min(1),
  maxTokens: Schema.number().step(1).min(1),
  models: Schema.array(DeepSeekCatalogModelSchema).default(
    [...DEFAULT_DEEPSEEK_MODELS] as unknown as Schemastery.TypeT<
      typeof DeepSeekCatalogModelSchema
    >[],
  ),
});

const PiAiProvider = Schema.object({
  apiKeyEnv: Schema.string().role("credential-ref"),
  baseURL: Schema.string(),
  /** Optional HTTP(S) proxy for this provider (per-model `proxy` overrides). */
  proxy: Schema.string(),
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
      // Same as DeepSeek catalog: allow Codex 90% integers (not multiples of 1000).
      softBudgetMaxTokens: Schema.number().step(1).min(1),
      softBudgetKeepTokens: Schema.number().step(1).min(1),
      softBudgetBufferTokens: Schema.number().step(1).min(0),
      maxConcurrentSessions: Schema.number().step(1).min(1).max(64),
      // Same modality toggle the Models → Capacities row edits (DeepSeek catalog too).
      inputModalities: Schema.array(Schema.union(["text", "image"])),
      /** Optional HTTP(S) proxy; beats provider `proxy` when set. */
      proxy: Schema.string(),
      // Community / discover menus (OFM `reasoning.efforts`, DSH dict form).
      reasoning: Schema.object({
        efforts: Schema.array(
          Schema.object({
            id: Schema.string().required(),
            name: Schema.string(),
            description: Schema.string(),
          }),
        ),
        defaultEffort: Schema.string(),
      }),
      reasoningEfforts: Schema.any(),
      defaultReasoningEffort: Schema.string(),
    }),
  ),
});

const PiAiConfig = Schema.object({
  providers: Schema.dict(PiAiProvider),
  /**
   * Settings → Models list order (`llm.providers` ids, including brands like
   * `deepseek-official` that are not under `providers.*`). Unknown ids ignored;
   * missing ids append in discovery order.
   */
  providerOrder: Schema.array(Schema.string()),
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

/**
 * 向日葵免费车道的出口配置（与其它 LLM 提供方代理分开）。
 *
 * OpenCode 探测级联：**先直连**，0 可用后再试本字段给出的候选代理。
 * 取值：留空 / `auto` = 直连失败后探测本机回环常见口；显式 URL = 直连失败后
 * 用该代理；`off` = 只直连、永不试代理。保存后 Host 热重挂并重新级联探测。
 * Kilo 车道另见 `kiloProxy`（默认直连）。
 */
const SunflowerFreeConfig = Schema.object({
  // Cascade candidate only: probe tries direct first; this value is used when
  // direct yields 0 usable models. empty/auto → loopback discover; off → never.
  openCodeProxy: Schema.string()
    .default("")
    .description(
      "OpenCode egress candidate (direct first). URL, auto, or off. Save re-probes.",
    ),
  kiloProxy: Schema.string()
    .default("")
    .description("Kilo lane proxy (default direct). URL, auto, or off."),
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
  /** Cap parallel tool settles in one step. Product default 5. */
  maxParallelToolCalls: Schema.number().step(1).min(1).default(5),
  /** Max LLM steps per user turn (tool rounds). Harness/server default 200. */
  maxSteps: Schema.number().step(1).min(1).default(200),
  /**
   * Resume automatically when a model stops at its output token cap.
   * Product default on: a truncated mid-task reply should keep going without
   * a manual nudge (Settings can still turn it off).
   */
  autoContinueOnMaxTokens: Schema.boolean().default(true),
  /** Maximum automatic continuations per turn (independent of maxSteps). */
  autoContinueMaxRounds: Schema.number().step(1).min(1).max(10).default(10),
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
   * Omit → kernel default (30).
   */
  llmRetryMaxRetries: Schema.number().step(1).min(0).default(30),
  /**
   * Soft-budget strategy family (DSH prune→summary posture).
   * Soft ceiling numbers live on Models catalog (`softBudgetMaxTokens`).
   * `prune-summary` (default) · `prune-only` · `summary-only` · `off`.
   */
  compactionStrategy: Schema.union([
    "prune-summary",
    "prune-only",
    "summary-only",
    "off",
  ]).default("prune-summary"),
  /**
   * Soft-budget pre-trigger as percent of softMax (Codex ~90%). Soft ceiling
   * numbers stay on Models; this only advances when auto-compact starts.
   */
  softBudgetTriggerPercent: Schema.number().step(1).min(50).max(100).default(90),
  /**
   * Cap for post-compact `recent` tokens (Codex user-tail budget). Default 20_000.
   */
  compactRecentMaxTokens: Schema.number().step(1_000).min(2_000).default(20_000),
  /**
   * Extra keep-halving passes after the standard two soft-budget summaries.
   */
  softBudgetPeelAttempts: Schema.number().step(1).min(0).max(8).default(3),
  /**
   * Spill plain-text tool results over this UTF-8 byte ceiling (DSH spill-policy).
   * `0` disables spill (not recommended). Default 64_000.
   */
  toolResultMaxInlineBytes: Schema.number().step(1_000).min(0).default(64_000),
  /**
   * Default max live sessions per provider/model route (parent + subagent
   * count equally). Per-model `maxConcurrentSessions` in the Models catalog
   * overrides this. Routes are independent (A/x ≠ B/x).
   */
  maxConcurrentModelSessions: Schema.number().step(1).min(1).max(64).default(5),
});

const WebSearchConfig = Schema.object({
  provider: Schema.union([
    "auto",
    "tavily",
    "brave",
    "deepseek",
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
  mode: Schema.union(["off", "openai", "local"]).default("off"),
  baseUrl: Schema.string().default(""),
  /**
   * When true, bind `text_to_speech` on every tool surface (including Minimal /
   * IM). Uses OpenAI TTS when mode=openai + key; otherwise the in-process
   * memory TTS stub (local). Full voice_transcribe / voice_session still
   * follow `mode` (`local` = SenseVoice STT when assets + sherpa-onnx-node ready).
   */
  speakTools: Schema.boolean().default(false),
});

/**
 * Image generation (Plugins card). Env `XRK_IMAGE_GEN` remains CI bypass.
 * Keys via Credentials: openai · fal · xai · openrouter · deepinfra · krea · meta-ai.
 */
const ImageGenConfig = Schema.object({
  mode: Schema.union([
    "off",
    "openai",
    "fal",
    "xai",
    "openrouter",
    "deepinfra",
    "krea",
    "meta-ai",
  ]).default("off"),
  baseUrl: Schema.string().default(""),
  model: Schema.string().default(""),
});

/**
 * Video generation (Plugins card). Env `XRK_VIDEO_GEN` remains CI bypass.
 * Keys via Credentials: openai · fal · xai · openrouter · deepinfra.
 */
const VideoGenConfig = Schema.object({
  mode: Schema.union([
    "off",
    "openai",
    "fal",
    "xai",
    "openrouter",
    "deepinfra",
  ]).default("off"),
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
  /** When true, classify each tool call before execute (ask → Face approval). */
  enabled: Schema.boolean().default(false),
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
  toolsDefaultExpanded: Schema.boolean().default(false),
});

const DEFAULT_BOSS_STATUS_PRESETS_JSON = JSON.stringify([
  "摸鱼中",
  "认真打工",
  "开会中",
  "咖啡续命",
  "别催我",
  "灵感来了",
  "等回复",
  "深潜 debug",
]);

/** Companion body shape + named palette in session header / Status rail (client ui-plan). */
const UiPresenceConfig = Schema.object({
  /** When false, hide the ball; chat / Status / tools keep working. */
  enabled: Schema.boolean().default(true),
  shape: Schema.union([...MEMBER_SHAPES]).default("blob"),
  color: Schema.union([...MEMBER_COLORS]).default("cream"),
  kit: Schema.union([...MEMBER_KITS]).default("none"),
  kitHat: Schema.string().default("none"),
  kitGlasses: Schema.string().default("none"),
  kitHeld: Schema.string().default("none"),
  overlayHat: Schema.string().default(""),
  overlayGlasses: Schema.string().default(""),
  overlayHeld: Schema.string().default(""),
  stickers: Schema.string().default("[]"),
  /** Operator (Boss) work mood — emotion-ball id shown on Overview left seat. */
  moodId: Schema.string().default("16"),
  /** Free-text status under the Boss ball (e.g. 摸鱼中). */
  statusLine: Schema.string().default(""),
  /** Optional Boss call-name for `<seat_identity>` (e.g. 阿凯). */
  bossNickname: Schema.string().default(""),
  moodAt: Schema.number().default(0),
  /** JSON string[] of tip chips; edited in Plugins → 表情球. */
  statusPresets: Schema.string().default(DEFAULT_BOSS_STATUS_PRESETS_JSON),
  /**
   * Seat titles (独立于表情球外观开关). Preset id + three editable strings;
   * empty custom fields fall back to the preset.
   */
  titleScheme: Schema.union([
    "office",
    "corp",
    "crew",
    "guild",
  ] as const).default("office"),
  /** Empty = follow titleScheme × UI locale; non-empty = free-form any language. */
  titleBoss: Schema.string().default(""),
  titleManager: Schema.string().default(""),
  titleAgent: Schema.string().default(""),
});

/**
 * Settings base for `llm-pi-ai`: zero-config routes only.
 * Registry brands surface via `llm.providers` as the Settings add directory.
 */
function buildPiAiCatalogBase(): Record<string, unknown> {
  // 出厂不带任何 provider profile：模型列表默认只显示随产品内置的免费车道。
  // Ollama / DeepSeek 等仍在 Registry 里，用户可在 Settings → 模型 手动添加。
  return { providers: {} };
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
      ns: "ui-presence",
      schema: schemasteryJson(UiPresenceConfig) as FaceSchemaEnvelope,
      base: {
        enabled: true,
        shape: "blob",
        color: "cream",
        kit: "none",
        kitHat: "none",
        kitGlasses: "none",
        kitHeld: "none",
        overlayHat: "",
        overlayGlasses: "",
        overlayHeld: "",
        stickers: "[]",
        moodId: "16",
        statusLine: "",
        bossNickname: "",
        moodAt: 0,
        statusPresets: DEFAULT_BOSS_STATUS_PRESETS_JSON,
        titleScheme: "office",
        titleBoss: "",
        titleManager: "",
        titleAgent: "",
      },
      applies: "live",
    },
    {
      ns: "permission",
      schema: FACE_PERMISSION_SCHEMA,
      base: permissionSettingsBase(),
      applies: "live",
    },
    {
      ns: "agent-default-model",
      schema: schemasteryJson(AgentDefaultModelConfig) as FaceSchemaEnvelope,
      // 出厂不写死某家 provider：留空后 `resolveSessionModelSelection` 取模型
      // 目录首项（目录只收「路由可用」的 provider），用户显式选过则以用户为准。
      base: {},
      applies: "live",
    },
    {
      // Host 若接线 `syncSunflowerFree`，保存后热重挂 sidecar + 重探（live）；
      // 未接线时仍提示 restart。
      ns: "sunflower-free",
      schema: schemasteryJson(SunflowerFreeConfig) as FaceSchemaEnvelope,
      base: { openCodeProxy: "", kiloProxy: "" },
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
        maxParallelToolCalls: 5,
        maxSteps: 200,
        autoContinueOnMaxTokens: true,
        autoContinueMaxRounds: 10,
        toolSettle: "parallel",
        llmRetryMaxRetries: 30,
        compactionStrategy: "prune-summary",
        softBudgetTriggerPercent: 90,
        compactRecentMaxTokens: 20_000,
        softBudgetPeelAttempts: 3,
        toolResultMaxInlineBytes: 64_000,
        maxConcurrentModelSessions: 5,
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
      // enabled: next idle agent rebuild adds/drops the tool + frozen block.
      // phase2Llm: read at session end; saving this ns still invalidates idle agents.
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
      base: { enabled: false, classifierUrl: "" },
      // Enable + classifier resolve live (Host tool pre + /auto-review/classify).
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
      base: { busyEnter: "queue", toolsDefaultExpanded: false },
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
