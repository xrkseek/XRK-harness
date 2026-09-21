import { createAgent, type AgentHandle } from "@xrkseek/core-agent";
import {
  createMemorySessionStore,
  readSessionEvents,
  type CompactionOptions,
  type SessionStore,
} from "@xrkseek/core-session";
import { prepareFaceSessionReferences } from "@xrkseek/xrk-session-reference/prepare-face";
import {
  createSystemPromptAssembler,
  type SystemPromptAssembler,
} from "@xrkseek/core-system-prompt";
import {
  createReadTracker,
  createStdTools,
  createToolPipeline,
  createToolRegistry,
  createWriteIntentGuard,
  extractPathArg,
  SUBAGENT_ROUTING_PROMPT_TEXT,
  type ToolDefinition,
  type ToolPipeline,
  type ToolRegistry,
} from "@xrkseek/core-tools";
import {
  createFsLocalProvider,
  createFsTools,
  createReadImageTool,
  formatFsRoutingPrompt,
  formatShellRoutingPrompt,
  type FsService,
} from "@xrkseek/exec-fs";
import type { AttachmentStore } from "@xrkseek/attachment";
import {
  formatWebFetchGuidance,
  formatWebSearchGuidance,
  formatBrowserGuidance,
  createDefaultWebAccess,
  createWebTools,
  createBrowserTools,
  createBrowserSession,
  type WebAccess,
} from "@xrkseek/exec-web";
import {
  COMPUTER_USE_PROMPT_TEXT,
  createComputerUseTools,
  createDefaultComputerUseAccess,
  type ComputerUseService,
} from "@xrkseek/exec-computer-use";
import {
  VOICE_PROMPT_TEXT,
  createDefaultVoiceAccess,
  createVoiceTools,
  type VoiceService,
} from "@xrkseek/exec-voice";
import {
  IMAGE_GEN_PROMPT_TEXT,
  createDefaultImageGenAccess,
  createImageGenTools,
  type ImageGenService,
} from "@xrkseek/exec-image-gen";
import {
  VIDEO_GEN_PROMPT_TEXT,
  createDefaultVideoGenAccess,
  createVideoGenTools,
  type VideoGenService,
} from "@xrkseek/exec-video-gen";
import {
  createCuratedMemoryStore,
  createCuratedMemoryTools,
  writeReusableNotesAfterTurn,
  type CuratedMemoryStore,
} from "@xrkseek/exec-memory";
import {
  LSP_PROMPT_TEXT,
  createDefaultLspAccess,
  createLspTools,
  type LspService,
} from "@xrkseek/exec-lsp";
import {
  PTY_PROMPT_TEXT,
  createDefaultPtyAccess,
  createPtyTools,
  type TerminalSessionService,
} from "@xrkseek/exec-pty";
import {
  createSandboxStack,
  createSandboxWrapGuard,
  type SandboxBackendKind,
  type SandboxService,
  type WindowsSandboxMode,
} from "@xrkseek/exec-sandbox";
import {
  CRON_PROMPT_TEXT,
  createCronTools,
  type CronScheduler,
} from "@xrkseek/server-cron";
import {
  createBashTools,
  createLocalShell,
  createSessionScopedShell,
  toJobView,
  JOBS_PROMPT_TEXT,
} from "@xrkseek/exec-shell";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import {
  createRunCodeTool,
  createWorkerCodeRuntime,
} from "@xrkseek/code-runtime";
import type { LlmAdapter } from "@xrkseek/llm";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  createPolicyToolPre,
  createSessionReadOnlyToolPre,
  type PolicyEngine,
} from "@xrkseek/policy";
import {
  effectiveSandboxMode,
  shouldConfineSandbox,
} from "@xrkseek/protocol";
import {
  createLifecycleWebhookNotifier,
  createPolicyEngineFromPlugins,
  createShellHookPre,
  defaultLifecycleWebhookPaths,
  defaultShellHookPaths,
  loadLifecycleWebhooks,
  loadShellHookCommands,
  wireCompositionHooks,
  wireCompositionTools,
  wireCompositionPrompts,
  type LifecycleWebhookFetch,
  type LifecycleWebhookNotifier,
  type LifecycleWebhookTarget,
  type RegisteredPlugin,
  type ShellHookCommand,
  type ShellHookRunner,
} from "@xrkseek/server-loader";
import {
  createDefaultSessionTelemetryAccess,
  wrapStoreForSessionTelemetry,
  type SessionTelemetrySink,
} from "@xrkseek/session-telemetry";
import path from "node:path";
import {
  createWorkspaceInjector,
  createWorkspaceToolOutputPersist,
  createSkillTools,
  createSlashResolver,
  loadOfficeRecipes,
  mergeRecipesById,
  appendWorkspaceInjectsIfChanged,
  resolveProductHome,
  SKILL_TOOL_GUIDANCE,
  type ResolveWorkspaceInjectOptions,
  type WorkspaceInjector,
} from "@xrkseek/workspace";

export const presetId = "harness" as const;

export type PresentationMode = "tools" | "code";

/** false = skip; true/omit = inject from `{root}/.xrk`; object = tune. */
export type WorkspaceInjectOption =
  | boolean
  | Omit<ResolveWorkspaceInjectOptions, "root">;

function ensureSession(store: SessionStore, id?: string): string {
  if (id) {
    if (store.has(id)) return id;
    return store.create(id).id;
  }
  return store.create().id;
}

export interface HarnessCompositionOptions {
  readonly workspaceRoot: string;
  /** Sidebar workspace title — prepended to durable inject (display-only). */
  readonly workspaceDisplayTitle?: string;
  readonly llm?: LlmAdapter;
  readonly system?: string;
  readonly sessionStore?: SessionStore;
  readonly sessionId?: string;
  readonly fs?: FsService;
  /**
   * When true, skip local `path.resolve` workspace sandbox (SSH / remote cwd).
   * Deny-list still applies. Host sets this with `@xrkseek/exec-ssh` providers.
   */
  readonly remoteExecution?: boolean;
  /**
   * Sandbox Provider kind (same `SandboxService` Definition). Default from
   * `XRK_SANDBOX_BACKEND` or `workspace`. `docker` needs `XRK_SANDBOX_DOCKER_IMAGE`
   * (or `sandboxDockerImage`). `bwrap` is Linux-only. `windows` needs a
   * Codex-style helper (`XRK_SANDBOX_WINDOWS_HELPER` or `sandboxWindowsHelper`)
   * and fails closed without it.
   */
  readonly sandboxBackend?: SandboxBackendKind;
  /** Docker image when `sandboxBackend` / env is `docker`. */
  readonly sandboxDockerImage?: string;
  /** Windows helper binary when `sandboxBackend` / env is `windows`. */
  readonly sandboxWindowsHelper?: string;
  /** Windows permission posture (default `workspace-write`). */
  readonly sandboxWindowsMode?: WindowsSandboxMode;
  /** Windows network egress (default false). */
  readonly sandboxWindowsNetwork?: boolean;
  /** Optional override of the whole sandbox stack (tests). */
  readonly sandbox?: SandboxService;
  /**
   * Host cron scheduler — registers `cronjob`. Default: off in composition;
   * Host passes the live scheduler when `XRK_CRON` is not `0`.
   */
  readonly cronScheduler?: CronScheduler;
  /** Optional `run_code` backend (SSH Node or local worker). */
  readonly codeRuntime?: import("@xrkseek/code-runtime").CodeRuntime;
  readonly assemble?: boolean;
  /** Default `tools`. `code` adds experimental `run_code` (still keeps fs/shell). */
  readonly presentation?: PresentationMode;
  /**
   * Wire product workspace as durable `user/message` injects (skill catalog +
   * agent-instructions) at turn start. Default: on when assemble is enabled.
   * See docs/workspace-inject.md.
   */
  readonly workspaceInject?: WorkspaceInjectOption;
  /**
   * Load `{productDir}/recipes/*.yaml` for `/id …` expand on turns.
   * Default: on when assemble is enabled. `false` skips recipes only;
   * `/skill-name` still expands when assemble is on. string = recipes dir.
   * See docs/slash-recipes.md.
   */
  readonly slashRecipes?: boolean | string;
  /** Extra tools registered after builtins (name clash throws). */
  readonly extraTools?: readonly ToolDefinition[];
  /** Host plugins — `kind: tools` merged after extras; explicit names win. */
  readonly plugins?: readonly RegisteredPlugin[];
  /**
   * Register `web_search` / `web_fetch`. Default: on (`createDefaultWebAccess`).
   * `false` skips. Pass a `WebAccess` to inject search/fetch in tests.
   */
  readonly webTools?: boolean | WebAccess;
  /**
   * Register `computer_use` (desktop AX tree + input). Default: on.
   * `false` skips. Pass a `ComputerUseService` to inject. Without
   * `XRK_COMPUTER_USE=1` (Windows UIA) / `memory` / inject → tool still
   * visible, execute is an honest error. Separate from browser_*.
   */
  readonly computerUseTools?: boolean | ComputerUseService;
  /**
   * Register voice Host tools (`text_to_speech` · `voice_transcribe` · `voice_session`).
   * Default: on. `false` skips. Pass a `VoiceService` to inject.
   * Without `XRK_VOICE=1` (+ API key) / `memory` / inject → tools still
   * visible, execute is an honest error.
   */
  readonly voiceTools?: boolean | VoiceService;
  /**
   * Register `image_generate` (text-to-image). Default: on.
   * `false` skips. Pass an `ImageGenService` to inject.
   * Without `XRK_IMAGE_GEN=1` (+ API key) / `memory` / inject → tool still
   * visible, execute is an honest error.
   */
  readonly imageGenTools?: boolean | ImageGenService;
  /**
   * Register `video_generate` (text-to-video, async job lifecycle). Default: on.
   * `false` skips. Pass a `VideoGenService` to inject.
   * Without `XRK_VIDEO_GEN=1` (+ API key) / `memory` / inject → tool still
   * visible, execute is an honest error.
   */
  readonly videoGenTools?: boolean | VideoGenService;
  /**
   * Register `memory` (curated MEMORY.md / USER.md). Default: on.
   * `false` skips. Pass a `CuratedMemoryStore` to inject (tests).
   * The system-prompt block is frozen when this composition is created.
   * Tool writes update disk only. Not the Mnemon document library.
   */
  readonly curatedMemory?: false | CuratedMemoryStore;
  /**
   * Register `lsp`. Default: on. `false` skips.
   * Pass an `LspService` to inject in tests. No `XRK_LSP_COMMAND` → tool
   * still visible, execute is an honest error.
   */
  readonly lspTools?: boolean | LspService;
  /**
   * Register PTY six-pack (`terminal_open/send/read/signal/close/list`).
   * Default: on. `false` skips. Pass a `TerminalSessionService` to inject
   * (Host shares one registry across agent invalidate for sandbox fence).
   * Missing `node-pty` → tools still visible, `terminal_open` is an honest error.
   * `terminal_send` supports `run_in_background` via composition shell jobs (`pty-send`).
   */
  readonly ptyTools?: boolean | TerminalSessionService;
  /**
   * Shared jobs registry (Host). When set, composition scopes it by `sessionId`
   * and does not dispose it — Host stop owns teardown.
   */
  readonly shell?: import("@xrkseek/exec-shell").ShellService;
  /** Optional policy engine → `pipeline.onPre(createPolicyToolPre)`. */
  readonly policy?: PolicyEngine;
  /**
   * Shell PreToolUse hooks (`hooks.json`). Default: load `~/.xrk/hooks.json`
   * then `{workspace}/.xrk/hooks.json`. `false` disables. Pass `commands` /
   * `paths` / `runner` to override (tests).
   */
  readonly shellHooks?:
    | false
    | {
        readonly commands?: readonly ShellHookCommand[];
        readonly paths?: readonly string[];
        readonly defaultTimeoutMs?: number;
        readonly runner?: ShellHookRunner;
      };
  /**
   * Outbound lifecycle webhooks (`webhooks.json`). Default: load
   * `~/.xrk/webhooks.json` then `{workspace}/.xrk/webhooks.json`.
   * `false` disables. Notify-only (never blocks turns/tools).
   */
  readonly lifecycleWebhooks?:
    | false
    | {
        readonly targets?: readonly LifecycleWebhookTarget[];
        readonly paths?: readonly string[];
        readonly fetchImpl?: LifecycleWebhookFetch;
        readonly env?: NodeJS.ProcessEnv;
      };
  /**
   * Session telemetry (OpenTelemetry OTLP/HTTP logs). Default: resolve from
   * `XRK_TELEMETRY` / OTEL_* env. `false` disables. Pass a `sink` to inject.
   * Capture is notify-only (never blocks turns).
   */
  readonly sessionTelemetry?:
    | false
    | SessionTelemetrySink
    | {
        readonly sink?: SessionTelemetrySink;
        readonly env?: NodeJS.ProcessEnv;
        readonly fetchImpl?: import("@xrkseek/session-telemetry").OtlpFetch;
        readonly serviceName?: string;
      };
  /** Host vision: resolve attachment bytes for image user content. */
  readonly resolveImage?: Parameters<typeof createAgent>[0]["resolveImage"];
  /** Host: AttachmentStore.fileHostPath → absolute path for uploaded files. */
  readonly resolveFilePath?: Parameters<typeof createAgent>[0]["resolveFilePath"];
  /**
   * Absolute host directories `read_file` may open outside the workspace
   * (attachment alias root). Writes remain workspace-bound.
   */
  readonly hostReadableRoots?: readonly string[];
  /** Durable image store — enables `read_image` when set. */
  readonly attachments?: AttachmentStore;
  /** Gate `read_image` on live route image modality (Host). */
  readonly routeAllowsImage?: () => boolean;
  /**
   * Context compaction. Default soft budgets + overflow retry + `/compact`.
   * `false` skips overflow retry; manual compact still works.
   */
  readonly compaction?: false | CompactionOptions;
  /** Face `agent-loop.maxParallelToolCalls` — bounds parallel tool settles. */
  readonly maxParallelToolCalls?: number;
  /** Face `agent-loop.toolSettle` — `parallel` (default) or force `serial`. */
  readonly toolSettle?: "serial" | "parallel";
  /**
   * Face `agent-loop.llmRetryMaxRetries`.
   * `0` disables step retries; omit uses kernel default (5).
   */
  readonly llmRetryMaxRetries?: number;
  /**
   * Max LLM steps per user turn. Default **32** (harness/server).
   * Face `agent-loop.maxSteps` overrides when Host injects it.
   */
  readonly maxSteps?: number;
  /**
   * Face `agent-loop.toolOrder` — DSH-style wire order with one `' '` rest.
   * Forwarded into `assemble.toolOrder`.
   */
  readonly toolOrder?: readonly string[];
  /** Face `bash.timeoutMs` / `maxOutputBytes` / `foregroundYieldMs` — applied to the bash tool. */
  readonly bashLimits?: {
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly foregroundYieldMs?: number;
  };
  /**
   * Face `agent-loop.toolResultMaxInlineBytes` — spill ceiling (`0` disables).
   * Omit → kernel default 64_000.
   */
  readonly toolResultMaxInlineBytes?: number;
  /**
   * Face `web-search` + Credentials vault (structured; preferred over env).
   */
  readonly webSearch?: import("@xrkseek/exec-web").SearchAccessConfig;
  /**
   * Register `tool:subagent` routing prompt. Default true.
   * Frugal / no-subagent session badges set false (Host still gates bindSubagentTools).
   */
  readonly subagentRouting?: boolean;
}

export interface HarnessComposition {
  readonly id: typeof presetId;
  readonly description: string;
  readonly workspaceRoot: string;
  readonly fs: FsService;
  readonly workspace: WorkspaceInjector;
  readonly tools: ToolRegistry;
  readonly pipeline: ToolPipeline;
  readonly llm: LlmAdapter;
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly prompts: SystemPromptAssembler;
  createAgent(): Promise<AgentHandle>;
  dumpConfig(patch?: Record<string, unknown>): Record<string, unknown>;
  /** Cancel background jobs + await settlement (composition teardown). */
  dispose(): Promise<void>;
}

function shouldInject(
  assemble: boolean | undefined,
  opt: WorkspaceInjectOption | undefined,
): boolean {
  if (opt === false) return false;
  if (assemble === false) return false;
  return true;
}

function toInjectOptions(
  root: string,
  opt: WorkspaceInjectOption | undefined,
  displayTitle?: string,
): ResolveWorkspaceInjectOptions {
  const extra = typeof opt === "object" && opt ? opt : {};
  return {
    root,
    ...extra,
    ...(displayTitle?.trim() ? { displayTitle: displayTitle.trim() } : {}),
  };
}

function wrapStoreForLifecycleWebhooks(
  store: SessionStore,
  notifier: LifecycleWebhookNotifier,
  sessionId: string,
): SessionStore {
  return {
    create: (id) => store.create(id),
    get: (id) => store.get(id),
    has: (id) => store.has(id),
    list: () => store.list(),
    readEvents: (id, from, to) => store.readEvents(id, from, to),
    ...(store.listHints
      ? { listHints: (id: string) => store.listHints!(id) }
      : {}),
    ...(store.isLoaded
      ? { isLoaded: (id: string) => store.isLoaded!(id) }
      : {}),
    append(id, event) {
      const logged = store.append(id, event);
      if (id === sessionId) {
        if (event.type === "turn/start") {
          notifier.fire({
            hookEventName: "turn/start",
            turnId: event.turnId,
          });
        } else if (event.type === "turn/end") {
          notifier.fire({
            hookEventName: "turn/end",
            turnId: event.turnId,
            extra: { reason: event.reason },
          });
        }
      }
      return logged;
    },
  };
}

/** Composition: fs + shell + sandbox guards + workspace inject. */
export function createHarnessComposition(
  options: HarnessCompositionOptions,
): HarnessComposition {
  const fs =
    options.fs ??
    createFsLocalProvider({
      root: options.workspaceRoot,
      ...(options.hostReadableRoots?.length
        ? { hostReadableRoots: options.hostReadableRoots }
        : {}),
    });
  const sharedShell = options.shell;
  const baseStore = options.sessionStore ?? createMemorySessionStore();
  const sessionId = ensureSession(baseStore, options.sessionId);
  let telemetrySink: SessionTelemetrySink | undefined;
  if (options.sessionTelemetry !== false) {
    if (
      options.sessionTelemetry &&
      typeof options.sessionTelemetry === "object" &&
      "emit" in options.sessionTelemetry
    ) {
      telemetrySink = options.sessionTelemetry;
    } else {
      const telOpt =
        typeof options.sessionTelemetry === "object"
          ? options.sessionTelemetry
          : undefined;
      telemetrySink =
        telOpt?.sink ??
        createDefaultSessionTelemetryAccess({
          ...(telOpt?.env !== undefined ? { env: telOpt.env } : {}),
          ...(telOpt?.fetchImpl !== undefined
            ? { fetchImpl: telOpt.fetchImpl }
            : {}),
          ...(telOpt?.serviceName !== undefined
            ? { serviceName: telOpt.serviceName }
            : {}),
        }).sink;
    }
  }
  let store: SessionStore = telemetrySink
    ? wrapStoreForSessionTelemetry({
        store: baseStore,
        sink: telemetrySink,
        sessionId,
      })
    : baseStore;
  let lifecycleNotifier: LifecycleWebhookNotifier | undefined;
  if (options.lifecycleWebhooks !== false) {
    const webhookOpt =
      typeof options.lifecycleWebhooks === "object"
        ? options.lifecycleWebhooks
        : undefined;
    const targets =
      webhookOpt?.targets ??
      loadLifecycleWebhooks(
        webhookOpt?.paths ??
          defaultLifecycleWebhookPaths(
            options.workspaceRoot,
            resolveProductHome(),
          ),
      );
    if (targets.length > 0) {
      lifecycleNotifier = createLifecycleWebhookNotifier({
        targets,
        sessionId,
        workspaceRoot: options.workspaceRoot,
        ...(webhookOpt?.env !== undefined ? { env: webhookOpt.env } : {}),
        ...(webhookOpt?.fetchImpl !== undefined
          ? { fetchImpl: webhookOpt.fetchImpl }
          : {}),
      });
    }
  }
  if (lifecycleNotifier) {
    store = wrapStoreForLifecycleWebhooks(store, lifecycleNotifier, sessionId);
  }
  const sandbox =
    options.sandbox ??
    createSandboxStack({
      workspaceRoot: options.workspaceRoot,
      ...(options.sandboxBackend !== undefined
        ? { backend: options.sandboxBackend }
        : {}),
      ...(options.sandboxDockerImage !== undefined
        ? { dockerImage: options.sandboxDockerImage }
        : {}),
      ...(options.sandboxWindowsHelper !== undefined
        ? { windowsHelper: options.sandboxWindowsHelper }
        : {}),
      ...(options.sandboxWindowsMode !== undefined
        ? { windowsMode: options.sandboxWindowsMode }
        : {}),
      ...(options.sandboxWindowsNetwork !== undefined
        ? { windowsNetwork: options.sandboxWindowsNetwork }
        : {}),
      ...(options.remoteExecution ? { remoteExecution: true } : {}),
    });
  const sandboxMode = effectiveSandboxMode(
    readSessionEvents(store, sessionId),
    "workspace-write",
  );
  const rootShell =
    sharedShell ??
    createLocalShell({
      subprocess: createLocalSubprocess(),
      defaultCwd: options.workspaceRoot,
      ...(shouldConfineSandbox(sandboxMode)
        ? {
            prepareArgv: (
              argv: readonly string[],
              cwd: string | undefined,
              signal?: AbortSignal,
            ) => sandbox.confine(argv, cwd, signal),
          }
        : {}),
    });
  const shell = createSessionScopedShell(rootShell, sessionId);
  const injectOpts = toInjectOptions(
    options.workspaceRoot,
    options.workspaceInject,
    options.workspaceDisplayTitle,
  );
  const productDir =
    injectOpts.productDir ?? path.join(injectOpts.root, ".xrk");

  const tools = createToolRegistry();
  for (const tool of createFsTools(fs)) tools.register(tool);
  if (options.attachments) {
    tools.register(
      createReadImageTool({
        fs,
        attachments: options.attachments,
        ...(options.routeAllowsImage
          ? { routeAllowsImage: options.routeAllowsImage }
          : {}),
      }),
    );
  }
  for (const tool of createBashTools(shell, {
    ...(options.bashLimits?.timeoutMs !== undefined
      ? { timeoutMs: options.bashLimits.timeoutMs }
      : {}),
    ...(options.bashLimits?.foregroundYieldMs !== undefined
      ? { foregroundYieldMs: options.bashLimits.foregroundYieldMs }
      : {}),
    // Cap shell dumps at capture (DSH bash default 64_000).
    maxOutputBytes: options.bashLimits?.maxOutputBytes ?? 64_000,
    defaultCwd: options.workspaceRoot,
  })) tools.register(tool);
  for (const tool of createStdTools()) tools.register(tool);
  for (const tool of createSkillTools({
    workspaceRoot: injectOpts.root,
    productDir,
  })) {
    tools.register(tool);
  }
  if (options.webTools !== false) {
    const access =
      typeof options.webTools === "object"
        ? options.webTools
        : createDefaultWebAccess(
            options.webSearch ? { search: options.webSearch } : {},
          );
    for (const tool of createWebTools(access)) tools.register(tool);
    const browser = createBrowserSession({ fetch: access.fetch });
    for (const tool of createBrowserTools(
      browser,
      options.attachments
        ? {
            saveScreenshot: (png) =>
              options.attachments!.saveImage({
                data: png,
                mediaType: "image/png",
                name: "browser-snapshot.png",
              }),
          }
        : {},
    )) {
      tools.register(tool);
    }
  }
  if (options.computerUseTools !== false) {
    const service =
      typeof options.computerUseTools === "object"
        ? options.computerUseTools
        : createDefaultComputerUseAccess().service;
    for (const tool of createComputerUseTools({
      ...(service ? { service } : {}),
    })) {
      tools.register(tool);
    }
  }
  if (options.voiceTools !== false) {
    const service =
      typeof options.voiceTools === "object"
        ? options.voiceTools
        : createDefaultVoiceAccess().service;
    for (const tool of createVoiceTools({
      ...(service ? { service } : {}),
    })) {
      tools.register(tool);
    }
  }
  const curatedMemory =
    options.curatedMemory === false
      ? undefined
      : (options.curatedMemory ?? createCuratedMemoryStore());
  if (curatedMemory) {
    for (const tool of createCuratedMemoryTools(curatedMemory)) {
      tools.register(tool);
    }
  }
  if (options.imageGenTools !== false) {
    const service =
      typeof options.imageGenTools === "object"
        ? options.imageGenTools
        : createDefaultImageGenAccess().service;
    for (const tool of createImageGenTools({
      ...(service ? { service } : {}),
      ...(options.attachments ? { attachments: options.attachments } : {}),
    })) {
      tools.register(tool);
    }
  }
  if (options.videoGenTools !== false) {
    const service =
      typeof options.videoGenTools === "object"
        ? options.videoGenTools
        : createDefaultVideoGenAccess().service;
    for (const tool of createVideoGenTools({
      ...(service ? { service } : {}),
      ...(options.attachments ? { attachments: options.attachments } : {}),
    })) {
      tools.register(tool);
    }
  }
  if (options.lspTools !== false) {
    const service =
      typeof options.lspTools === "object"
        ? options.lspTools
        : createDefaultLspAccess().service;
    for (const tool of createLspTools({
      workspaceRoot: options.workspaceRoot,
      ...(service ? { service } : {}),
    })) {
      tools.register(tool);
    }
  }
  if (options.ptyTools !== false) {
    const service =
      typeof options.ptyTools === "object"
        ? options.ptyTools
        : createDefaultPtyAccess({
            workspaceRoot: options.workspaceRoot,
            ...(shouldConfineSandbox(sandboxMode)
              ? {
                  confine: (
                    argv: readonly string[],
                    cwd: string | undefined,
                    signal?: AbortSignal,
                  ) => sandbox.confine(argv, cwd, signal),
                }
              : {}),
          }).service;
    for (const tool of createPtyTools({
      workspaceRoot: options.workspaceRoot,
      service,
      jobs: shell,
      ownerSessionId: sessionId,
    })) {
      tools.register(tool);
    }
  }
  if (options.cronScheduler) {
    for (const tool of createCronTools(options.cronScheduler)) {
      tools.register(tool);
    }
  }
  if (options.presentation === "code" || options.codeRuntime) {
    tools.register(
      createRunCodeTool(options.codeRuntime ?? createWorkerCodeRuntime()),
    );
  }
  wireCompositionTools(tools, {
    ...(options.extraTools ? { extraTools: options.extraTools } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  });

  const tracker = createReadTracker();
  const toolOutputPersist = createWorkspaceToolOutputPersist();
  // Same byte ceiling as agent-loop spill (`0` disables both). One full-body write.
  const inlineCap = options.toolResultMaxInlineBytes;
  const pipeline = createToolPipeline({
    outputBound:
      inlineCap === 0
        ? false
        : {
            persist: (full) => toolOutputPersist.persist(full),
            ...(typeof inlineCap === "number" && inlineCap > 0
              ? { maxBytes: Math.floor(inlineCap) }
              : {}),
          },
  });
  const policyEngine = createPolicyEngineFromPlugins({
    ...(options.policy !== undefined ? { engine: options.policy } : {}),
    ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
  });
  if (policyEngine) {
    pipeline.onPre(createPolicyToolPre(policyEngine));
  }
  // Live read-only gate (session knobs), not create-time snapshot.
  pipeline.onPre(
    createSessionReadOnlyToolPre(
      () =>
        effectiveSandboxMode(readSessionEvents(store, sessionId)) ===
        "read-only",
    ),
  );
  // Shell PreToolUse (hooks.json) — after policy / read-only; before kind:hooks.
  if (options.shellHooks !== false) {
    const shellOpt =
      typeof options.shellHooks === "object" ? options.shellHooks : undefined;
    const shellCommands =
      shellOpt?.commands ??
      loadShellHookCommands(
        shellOpt?.paths ??
          defaultShellHookPaths(options.workspaceRoot, resolveProductHome()),
      );
    if (shellCommands.length > 0) {
      pipeline.onPre(
        createShellHookPre({
          commands: shellCommands,
          cwd: () => options.workspaceRoot,
          ...(shellOpt?.defaultTimeoutMs !== undefined
            ? { defaultTimeoutMs: shellOpt.defaultTimeoutMs }
            : {}),
          ...(shellOpt?.runner !== undefined ? { runner: shellOpt.runner } : {}),
        }),
      );
    }
  }
  // kind:hooks — after policy / read-only / shell; before guards + builtin post.
  if (options.plugins) {
    wireCompositionHooks(pipeline, { plugins: options.plugins });
  }
  if (shouldConfineSandbox(sandboxMode)) {
    pipeline.onGuard(createSandboxWrapGuard(sandbox));
    pipeline.onGuard(
      createWriteIntentGuard({
        hasRead: (p) => tracker.hasRead(p),
        writeToolNames: ["apply_edit", "write_file"],
      }),
    );
  }
  if (lifecycleNotifier) {
    const notifier = lifecycleNotifier;
    pipeline.onPost(async (ctx) => {
      notifier.fireToolPost({
        toolName: ctx.call.name,
        toolUseId: ctx.call.id,
        isError: ctx.result?.isError === true,
        skippedBody: ctx.skippedBody === true,
      });
      return { action: "accept" };
    });
  }
  pipeline.onPost(async (ctx) => {
    if (
      ctx.call.name === "read_file" &&
      ctx.result &&
      !ctx.result.isError
    ) {
      const pathArg = extractPathArg(ctx.args);
      if (pathArg) tracker.markRead(pathArg);
    }
    return { action: "accept" };
  });

  const llm =
    options.llm ??
    createReplayAdapter([
      {
        content: "hello from harness preset (replay). Tools: fs + bash.",
      },
    ]);

  const persona =
    options.system ??
    "You are a coding agent with filesystem, shell, and web tools.";
  /** When set, routing sections follow this catalog (materialize / filter); else live registry. */
  let routingNames: ReadonlySet<string> | undefined;
  const availableToolNames = (): ReadonlySet<string> =>
    routingNames ?? new Set(tools.list().map((t) => t.name));
  const prompts = createSystemPromptAssembler();
  prompts.register({
    id: "base",
    order: 0,
    content: () => persona,
  });
  if (curatedMemory) {
    const frozenMemory = curatedMemory.frozenSystemBlock();
    prompts.register({
      id: "curated-memory",
      order: 2,
      content: () => frozenMemory,
    });
  }
  if (options.webTools !== false) {
    prompts.register({
      id: "tool:web_search",
      order: 110,
      content: () => formatWebSearchGuidance(availableToolNames()),
    });
    prompts.register({
      id: "tool:web_fetch",
      order: 111,
      content: () => formatWebFetchGuidance(availableToolNames()),
    });
    prompts.register({
      id: "tool:browser",
      order: 115,
      content: () => formatBrowserGuidance(availableToolNames()),
    });
  }
  if (options.computerUseTools !== false) {
    prompts.register({
      id: "tool:computer_use",
      order: 116,
      content: () =>
        availableToolNames().has("computer_use")
          ? COMPUTER_USE_PROMPT_TEXT
          : "",
    });
  }
  if (options.voiceTools !== false) {
    prompts.register({
      id: "tool:voice",
      order: 118,
      content: () =>
        availableToolNames().has("text_to_speech") ||
        availableToolNames().has("voice_transcribe") ||
        availableToolNames().has("voice_session")
          ? VOICE_PROMPT_TEXT
          : "",
    });
  }
  if (options.imageGenTools !== false) {
    prompts.register({
      id: "tool:image_gen",
      order: 119,
      content: () =>
        availableToolNames().has("image_generate")
          ? IMAGE_GEN_PROMPT_TEXT
          : "",
    });
  }
  if (options.videoGenTools !== false) {
    prompts.register({
      id: "tool:video_gen",
      order: 120,
      content: () =>
        availableToolNames().has("video_generate") ? VIDEO_GEN_PROMPT_TEXT : "",
    });
  }
  if (options.cronScheduler) {
    prompts.register({
      id: "tool:cron",
      order: 117,
      content: () =>
        availableToolNames().has("cronjob") ? CRON_PROMPT_TEXT : "",
    });
  }
  prompts.register({
    id: "tool:skill",
    order: 112,
    content: () => SKILL_TOOL_GUIDANCE,
  });
  if (options.lspTools !== false) {
    prompts.register({
      id: "tool:lsp",
      order: 113,
      content: () =>
        availableToolNames().has("lsp") ? LSP_PROMPT_TEXT : "",
    });
  }
  if (options.ptyTools !== false) {
    prompts.register({
      id: "tool:pty",
      order: 114,
      content: () => {
        const names = availableToolNames();
        const hasTerminal =
          names.has("terminal_open") ||
          names.has("terminal_send") ||
          names.has("terminal_read") ||
          names.has("terminal_list") ||
          names.has("terminal_close") ||
          names.has("terminal_signal");
        return hasTerminal ? PTY_PROMPT_TEXT : "";
      },
    });
  }
  prompts.register({
    id: "tool:fs-routing",
    order: 104,
    content: () => formatFsRoutingPrompt(availableToolNames()),
  });
  prompts.register({
    id: "tool:shell-routing",
    order: 105,
    content: () => formatShellRoutingPrompt(availableToolNames()),
  });
  prompts.register({
    id: "tool:jobs",
    order: 106,
    content: () => {
      const names = availableToolNames();
      if (
        !names.has("job_list") &&
        !names.has("job_output") &&
        !names.has("job_kill")
      ) {
        return "";
      }
      return JOBS_PROMPT_TEXT;
    },
  });
  if (options.subagentRouting !== false) {
    prompts.register({
      id: "tool:subagent",
      order: 107,
      // Bound on the live agent after createAgent (Host); keep section when
      // composition opts in — do not require names on the freeze-time registry.
      content: () => SUBAGENT_ROUTING_PROMPT_TEXT,
    });
  }
  wireCompositionPrompts(prompts, {
    ...(options.plugins ? { plugins: options.plugins } : {}),
    reservedIds: [
      "base",
      ...(curatedMemory ? ["curated-memory"] : []),
      "tool:skill",
      "tool:fs-routing",
      "tool:shell-routing",
      "tool:jobs",
      ...(options.subagentRouting !== false ? ["tool:subagent"] : []),
      ...(options.webTools !== false
        ? ["tool:web_search", "tool:web_fetch", "tool:browser"]
        : []),
      ...(options.computerUseTools !== false ? ["tool:computer_use"] : []),
      ...(options.voiceTools !== false ? ["tool:voice"] : []),
      ...(options.imageGenTools !== false ? ["tool:image_gen"] : []),
      ...(options.cronScheduler ? ["tool:cron"] : []),
      ...(options.lspTools !== false ? ["tool:lsp"] : []),
      ...(options.ptyTools !== false ? ["tool:pty"] : []),
    ],
  });

  const workspace = createWorkspaceInjector({
    root: injectOpts.root,
    ...(injectOpts.productDir !== undefined
      ? { productDir: injectOpts.productDir }
      : {}),
  });

  return {
    id: presetId,
    description:
      "XRK Harness: fs + shell + sandbox + web + browser + computer_use + voice + image_gen + lsp + pty + workspace inject",
    workspaceRoot: options.workspaceRoot,
    fs,
    workspace,
    tools,
    pipeline,
    llm,
    store,
    sessionId,
    prompts,
    async createAgent() {
      const useAssemble = options.assemble !== false;
      const injectOn =
        shouldInject(options.assemble, options.workspaceInject);
      const productDir =
        injectOpts.productDir ?? path.join(injectOpts.root, ".xrk");
      let recipes: Awaited<ReturnType<typeof loadOfficeRecipes>> = [];
      if (useAssemble && options.slashRecipes !== false) {
        if (typeof options.slashRecipes === "string") {
          recipes = await loadOfficeRecipes(options.slashRecipes);
        } else {
          const fromHome = await loadOfficeRecipes(
            path.join(resolveProductHome(), "recipes"),
          );
          const fromAgents = await loadOfficeRecipes(
            path.join(injectOpts.root, ".agents", "recipes"),
          );
          const fromProduct = await loadOfficeRecipes(
            path.join(productDir, "recipes"),
          );
          recipes = mergeRecipesById(fromHome, fromAgents, fromProduct);
        }
      }
      const assemblePersona = async (ctx: {
        readonly toolNames: readonly string[];
      }) => {
        routingNames = new Set(ctx.toolNames);
        try {
          return await prompts.assemble();
        } finally {
          routingNames = undefined;
        }
      };
      return createAgent({
        sessionId,
        store,
        llm,
        tools,
        pipeline,
        cwd: options.workspaceRoot,
        jobs: {
          list: () =>
            shell.listJobsNow().map((j) => ({
              ...toJobView(j),
              ...(j.reported ? { reported: true as const } : {}),
              ...(j.outputLimitBytes !== undefined
                ? { outputLimitBytes: j.outputLimitBytes }
                : {}),
            })),
          onJobsChanged: (listener) => shell.onJobsChanged(listener),
        },
        ...(useAssemble
          ? {
              assemble: {
                persona: assemblePersona,
                ...(options.toolOrder ? { toolOrder: options.toolOrder } : {}),
                resolveSlash: createSlashResolver({
                  workspaceRoot: injectOpts.root,
                  productDir,
                  recipes,
                }),
              },
            }
          : {
              // Legacy path: freeze once (no per-step tool visibility).
              system: await prompts.assemble(),
            }),
        ...(injectOn
          ? {
              beforeUserMessage: async (ctx) => {
                await appendWorkspaceInjectsIfChanged({
                  ...ctx,
                  injectOptions: injectOpts,
                  injector: workspace,
                });
              },
            }
          : {}),
        ...(curatedMemory
          ? {
              afterTurn: ({ userText, assistantText, turnId }) => {
                const memoryToolWrote = readSessionEvents(
                  store,
                  sessionId,
                ).some(
                  (event) =>
                    event.type === "tool/call" &&
                    event.turnId === turnId &&
                    event.call.name === "memory",
                );
                writeReusableNotesAfterTurn(curatedMemory, {
                  userText: userText ?? "",
                  assistantText,
                  memoryToolWrote,
                });
              },
            }
          : {}),
        prepareUserContent: ({ content, text, signal }) =>
          prepareFaceSessionReferences({
            targetSessionId: sessionId,
            content,
            text,
            readEvents: (id) => readSessionEvents(store, id),
            ...(signal ? { signal } : {}),
          }),
        ...(options.resolveImage
          ? { resolveImage: options.resolveImage }
          : {}),
        ...(options.resolveFilePath
          ? { resolveFilePath: options.resolveFilePath }
          : {}),
        compaction:
          options.compaction === false
            ? false
            : (options.compaction ?? {
                maxRequestTokens: 100_000,
                keepTokens: 24_000,
                bufferTokens: 4_000,
              }),
        ...(options.toolResultMaxInlineBytes !== undefined
          ? { toolResultMaxInlineBytes: options.toolResultMaxInlineBytes }
          : {}),
        ...(options.maxParallelToolCalls !== undefined
          ? { maxParallelToolCalls: options.maxParallelToolCalls }
          : {}),
        ...(options.toolSettle !== undefined
          ? { toolSettle: options.toolSettle }
          : {}),
        ...(options.llmRetryMaxRetries !== undefined
          ? {
              llmRetry:
                options.llmRetryMaxRetries <= 0
                  ? false
                  : { maxRetries: Math.floor(options.llmRetryMaxRetries) },
            }
          : {}),
        maxSteps: options.maxSteps ?? 32,
      });
    },
    dumpConfig(patch = {}) {
      return {
        preset: presetId,
        workspaceRoot: options.workspaceRoot,
        tools: tools.list().map((t) => t.name),
        llm: llm.id,
        sessionId,
        presentation: options.presentation ?? "tools",
        workspaceInject: options.workspaceInject !== false,
        slashRecipes: options.slashRecipes !== false,
        plugins: (options.plugins ?? []).map((p) => p.id),
        policy: Boolean(
          createPolicyEngineFromPlugins({
            ...(options.policy !== undefined ? { engine: options.policy } : {}),
            ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
          }),
        ),
        sessionTelemetry: Boolean(telemetrySink),
        ...patch,
      };
    },
    async dispose() {
      if (!sharedShell) await rootShell.dispose();
      if (telemetrySink) {
        try {
          await telemetrySink.shutdown();
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

export const preset = {
  id: presetId,
  description: "XRK Harness composition: fs + shell + sandbox + web + lsp + pty",
  create: createHarnessComposition,
};
