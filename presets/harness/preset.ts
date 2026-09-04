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
  FS_ROUTING_PROMPT_TEXT,
  SHELL_ROUTING_PROMPT_TEXT,
  type FsService,
} from "@xrkseek/exec-fs";
import type { AttachmentStore } from "@xrkseek/attachment";
import {
  WEB_FETCH_GUIDANCE,
  WEB_SEARCH_GUIDANCE,
  createDefaultWebAccess,
  createWebTools,
  type WebAccess,
} from "@xrkseek/exec-web";
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
  createDenyListSandbox,
  createSandboxWrapGuard,
  createWorkspaceSandbox,
} from "@xrkseek/exec-sandbox";
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
  createReadOnlyToolPre,
  type PolicyEngine,
} from "@xrkseek/policy";
import {
  effectiveSandboxMode,
  shouldConfineSandbox,
} from "@xrkseek/protocol";
import {
  createPolicyEngineFromPlugins,
  wireCompositionTools,
  wireCompositionPrompts,
  type RegisteredPlugin,
} from "@xrkseek/server-loader";
import path from "node:path";
import { homedir } from "node:os";
import {
  createWorkspaceInjector,
  createWorkspaceToolOutputPersist,
  createSkillTools,
  createSlashResolver,
  loadOfficeRecipes,
  mergeRecipesById,
  appendWorkspaceInjectsIfChanged,
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

/** System data home for seeded recipes (no server-config dep). */
function resolveHarnessHome(): string {
  for (const key of ["XRK_HOME", "XRK_DSH_HOME", "DSH_HOME"] as const) {
    const v = process.env[key]?.trim();
    if (v) return path.resolve(v);
  }
  return path.join(homedir(), ".xrk");
}

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
  /** Host vision: resolve attachment bytes for image user content. */
  readonly resolveImage?: Parameters<typeof createAgent>[0]["resolveImage"];
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

/** Composition: fs + shell + sandbox guards + workspace inject. */
export function createHarnessComposition(
  options: HarnessCompositionOptions,
): HarnessComposition {
  const fs =
    options.fs ?? createFsLocalProvider({ root: options.workspaceRoot });
  const sharedShell = options.shell;
  const rootShell =
    sharedShell ??
    createLocalShell({
      subprocess: createLocalSubprocess(),
      defaultCwd: options.workspaceRoot,
    });
  const store = options.sessionStore ?? createMemorySessionStore();
  const sessionId = ensureSession(store, options.sessionId);
  const shell = createSessionScopedShell(rootShell, sessionId);
  const sandbox = createWorkspaceSandbox({
    root: options.workspaceRoot,
    inner: createDenyListSandbox(),
  });
  const injectOpts = toInjectOptions(
    options.workspaceRoot,
    options.workspaceInject,
    options.workspaceDisplayTitle,
  );
  const productDir =
    injectOpts.productDir ?? path.join(injectOpts.root, ".xrk");
  const sandboxMode = effectiveSandboxMode(
    readSessionEvents(store, sessionId),
    "workspace-write",
  );

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
                  wrapArgv: (argv, cwd) => sandbox.wrapArgv(argv, cwd),
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
  if (options.presentation === "code") {
    tools.register(createRunCodeTool(createWorkerCodeRuntime()));
  }
  wireCompositionTools(tools, {
    ...(options.extraTools ? { extraTools: options.extraTools } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  });

  const tracker = createReadTracker();
  const toolOutputPersist = createWorkspaceToolOutputPersist({
    root: options.workspaceRoot,
  });
  const pipeline = createToolPipeline({
    outputBound: { persist: (full) => toolOutputPersist.persist(full) },
  });
  const policyEngine = createPolicyEngineFromPlugins({
    ...(options.policy !== undefined ? { engine: options.policy } : {}),
    ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
  });
  if (policyEngine) {
    pipeline.onPre(createPolicyToolPre(policyEngine));
  }
  if (sandboxMode === "read-only") {
    pipeline.onPre(createReadOnlyToolPre());
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
  const prompts = createSystemPromptAssembler();
  prompts.register({
    id: "base",
    order: 0,
    content: () => persona,
  });
  if (options.webTools !== false) {
    prompts.register({
      id: "tool:web_search",
      order: 110,
      content: () => WEB_SEARCH_GUIDANCE,
    });
    prompts.register({
      id: "tool:web_fetch",
      order: 111,
      content: () => WEB_FETCH_GUIDANCE,
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
      content: () => LSP_PROMPT_TEXT,
    });
  }
  if (options.ptyTools !== false) {
    prompts.register({
      id: "tool:pty",
      order: 114,
      content: () => PTY_PROMPT_TEXT,
    });
  }
  prompts.register({
    id: "tool:fs-routing",
    order: 104,
    content: () => FS_ROUTING_PROMPT_TEXT,
  });
  prompts.register({
    id: "tool:shell-routing",
    order: 105,
    content: () => SHELL_ROUTING_PROMPT_TEXT,
  });
  prompts.register({
    id: "tool:jobs",
    order: 106,
    content: () => JOBS_PROMPT_TEXT,
  });
  if (options.subagentRouting !== false) {
    prompts.register({
      id: "tool:subagent",
      order: 107,
      content: () => SUBAGENT_ROUTING_PROMPT_TEXT,
    });
  }
  wireCompositionPrompts(prompts, {
    ...(options.plugins ? { plugins: options.plugins } : {}),
    reservedIds: [
      "base",
      "tool:skill",
      "tool:fs-routing",
      "tool:shell-routing",
      "tool:jobs",
      ...(options.subagentRouting !== false ? ["tool:subagent"] : []),
      ...(options.webTools !== false ? ["tool:web_search", "tool:web_fetch"] : []),
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
    description: "XRK Harness: fs + shell + sandbox + web + lsp + pty + workspace inject",
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
      const system = await prompts.assemble();
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
            path.join(resolveHarnessHome(), "recipes"),
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
      return createAgent({
        sessionId,
        store,
        llm,
        tools,
        pipeline,
        system,
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
                persona: system,
                ...(options.toolOrder ? { toolOrder: options.toolOrder } : {}),
                resolveSlash: createSlashResolver({
                  workspaceRoot: injectOpts.root,
                  productDir,
                  recipes,
                }),
              },
            }
          : {}),
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
        ...patch,
      };
    },
    async dispose() {
      if (!sharedShell) await rootShell.dispose();
    },
  };
}

export const preset = {
  id: presetId,
  description: "XRK Harness composition: fs + shell + sandbox + web + lsp + pty",
  create: createHarnessComposition,
};
