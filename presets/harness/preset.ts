import { createAgent, type AgentHandle } from "@xrkseek/core-agent";
import {
  createMemorySessionStore,
  type SessionStore,
} from "@xrkseek/core-session";
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
  type ToolDefinition,
  type ToolPipeline,
  type ToolRegistry,
} from "@xrkseek/core-tools";
import {
  createFsLocalProvider,
  createFsTools,
  type FsService,
} from "@xrkseek/exec-fs";
import {
  createDenyListSandbox,
  createSandboxWrapGuard,
  createWorkspaceSandbox,
} from "@xrkseek/exec-sandbox";
import { createBashTools, createLocalShell } from "@xrkseek/exec-shell";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import {
  createRunCodeTool,
  createWorkerCodeRuntime,
} from "@xrkseek/code-runtime";
import type { LlmAdapter } from "@xrkseek/llm";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  createPolicyToolPre,
  type PolicyEngine,
} from "@xrkseek/policy";
import {
  wireCompositionTools,
  type RegisteredPlugin,
} from "@xrkseek/server-loader";
import path from "node:path";
import {
  createWorkspaceInjector,
  createWorkspaceToolOutputPersist,
  loadOfficeRecipes,
  resolveWorkspaceInject,
  tryApplySlashRecipe,
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
    try {
      store.get(id);
      return id;
    } catch {
      return store.create(id).id;
    }
  }
  return store.create().id;
}

export interface HarnessCompositionOptions {
  readonly workspaceRoot: string;
  readonly llm?: LlmAdapter;
  readonly system?: string;
  readonly sessionStore?: SessionStore;
  readonly sessionId?: string;
  readonly fs?: FsService;
  readonly assemble?: boolean;
  /** Default `tools`. `code` adds experimental `run_code` (still keeps fs/shell). */
  readonly presentation?: PresentationMode;
  /**
   * Wire product workspace into three-layer `workspaceBlocks`.
   * Default: on when assemble is enabled. See docs/workspace-inject.md.
   */
  readonly workspaceInject?: WorkspaceInjectOption;
  /**
   * Load `{productDir}/recipes/*.yaml` and wire `/id …` expand on turns.
   * Default: on when assemble is enabled. `false` skips; string = recipes dir.
   * See docs/slash-recipes.md.
   */
  readonly slashRecipes?: boolean | string;
  /** Extra tools registered after builtins (name clash throws). */
  readonly extraTools?: readonly ToolDefinition[];
  /** Host plugins — `kind: tools` merged after extras; explicit names win. */
  readonly plugins?: readonly RegisteredPlugin[];
  /** Optional policy engine → `pipeline.onPre(createPolicyToolPre)`. */
  readonly policy?: PolicyEngine;
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
): ResolveWorkspaceInjectOptions {
  const extra = typeof opt === "object" && opt ? opt : {};
  return { root, ...extra };
}

/** Composition: fs + shell + sandbox guards + workspace inject. */
export function createHarnessComposition(
  options: HarnessCompositionOptions,
): HarnessComposition {
  const fs =
    options.fs ?? createFsLocalProvider({ root: options.workspaceRoot });
  const subprocess = createLocalSubprocess();
  const shell = createLocalShell({ subprocess });
  const sandbox = createWorkspaceSandbox({
    root: options.workspaceRoot,
    inner: createDenyListSandbox(),
  });

  const tools = createToolRegistry();
  for (const tool of createFsTools(fs)) tools.register(tool);
  for (const tool of createBashTools(shell)) tools.register(tool);
  for (const tool of createStdTools()) tools.register(tool);
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
  if (options.policy) {
    pipeline.onPre(createPolicyToolPre(options.policy));
  }
  pipeline.onGuard(createSandboxWrapGuard(sandbox));
  pipeline.onGuard(
    createWriteIntentGuard({
      hasRead: (p) => tracker.hasRead(p),
      writeToolNames: ["apply_edit"],
    }),
  );
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

  const store = options.sessionStore ?? createMemorySessionStore();
  const sessionId = ensureSession(store, options.sessionId);
  const persona =
    options.system ??
    "You are a coding agent with filesystem and shell tools.";
  const prompts = createSystemPromptAssembler();
  prompts.register({
    id: "base",
    order: 0,
    content: () => persona,
  });

  const injectOpts = toInjectOptions(
    options.workspaceRoot,
    options.workspaceInject,
  );
  const workspace = createWorkspaceInjector({
    root: injectOpts.root,
    ...(injectOpts.productDir !== undefined
      ? { productDir: injectOpts.productDir }
      : {}),
  });

  return {
    id: presetId,
    description: "Harness: fs + shell + sandbox + workspace inject",
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
      let workspaceBlocks: readonly string[] | undefined;
      if (shouldInject(options.assemble, options.workspaceInject)) {
        const resolved = await resolveWorkspaceInject(injectOpts);
        workspaceBlocks = resolved.blocks;
      }
      let resolveSlash:
        | ((raw: string) => ReturnType<typeof tryApplySlashRecipe>)
        | undefined;
      if (useAssemble && options.slashRecipes !== false) {
        const recipesDir =
          typeof options.slashRecipes === "string"
            ? options.slashRecipes
            : path.join(
                injectOpts.productDir ??
                  path.join(injectOpts.root, ".xrk"),
                "recipes",
              );
        const recipes = await loadOfficeRecipes(recipesDir);
        if (recipes.length > 0) {
          resolveSlash = (raw) => tryApplySlashRecipe(raw, recipes);
        }
      }
      return createAgent({
        sessionId,
        store,
        llm,
        tools,
        pipeline,
        system,
        ...(useAssemble
          ? {
              assemble: {
                persona: system,
                ...(workspaceBlocks?.length ? { workspaceBlocks } : {}),
                ...(resolveSlash ? { resolveSlash } : {}),
              },
            }
          : {}),
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
        policy: Boolean(options.policy),
        ...patch,
      };
    },
  };
}

export const preset = {
  id: presetId,
  description: "Full harness composition: fs + shell + sandbox",
  create: createHarnessComposition,
};
