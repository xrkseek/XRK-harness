import { createAgent, type AgentHandle } from "@xrkseek/core-agent";
import {
  createMemorySessionStore,
  type CompactionOptions,
  type SessionStore,
} from "@xrkseek/core-session";
import {
  createSystemPromptAssembler,
  type SystemPromptAssembler,
} from "@xrkseek/core-system-prompt";
import {
  createReadTracker,
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
  wireCompositionTools,
  wireCompositionPrompts,
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

export const presetId = "minimal" as const;

function ensureSession(store: SessionStore, id?: string): string {
  if (id) {
    if (store.has(id)) return id;
    return store.create(id).id;
  }
  return store.create().id;
}

/** false = skip; true/omit = inject from `{root}/.xrk`; object = tune. */
export type WorkspaceInjectOption =
  | boolean
  | Omit<ResolveWorkspaceInjectOptions, "root">;

export interface MinimalCompositionOptions {
  readonly workspaceRoot: string;
  readonly llm?: LlmAdapter;
  readonly system?: string;
  readonly sessionStore?: SessionStore;
  readonly sessionId?: string;
  readonly fs?: FsService;
  readonly assemble?: boolean;
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
  /** Host vision: resolve attachment bytes for image user content. */
  readonly resolveImage?: Parameters<typeof createAgent>[0]["resolveImage"];
  /**
   * Context compaction. Default `{}` enables overflow retry + `/compact`.
   * `false` skips overflow retry; manual compact still works.
   */
  readonly compaction?: false | CompactionOptions;
}

export interface MinimalComposition {
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

/** Composition only — fs tools, no shell. */
export function createMinimalComposition(
  options: MinimalCompositionOptions,
): MinimalComposition {
  const fs =
    options.fs ?? createFsLocalProvider({ root: options.workspaceRoot });
  const tools = createToolRegistry();
  for (const tool of createFsTools(fs)) {
    tools.register(tool);
  }
  wireCompositionTools(tools, {
    ...(options.extraTools ? { extraTools: options.extraTools } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  });

  const tracker = createReadTracker();
  const toolOutputPersist = createWorkspaceToolOutputPersist({
    root: options.workspaceRoot,
  });
  const store = options.sessionStore ?? createMemorySessionStore();
  const sessionId = ensureSession(store, options.sessionId);
  const pipeline = createToolPipeline({
    outputBound: { persist: (full) => toolOutputPersist.persist(full) },
  });
  if (options.policy) {
    pipeline.onPre(createPolicyToolPre(options.policy));
  }
  const sandboxMode = effectiveSandboxMode(
    store.get(sessionId).events,
    "workspace-write",
  );
  if (sandboxMode === "read-only") {
    pipeline.onPre(createReadOnlyToolPre());
  }
  if (shouldConfineSandbox(sandboxMode)) {
    pipeline.onGuard(
      createWriteIntentGuard({
        hasRead: (p) => tracker.hasRead(p),
        writeToolNames: ["apply_edit"],
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
        content:
          "hello from minimal preset (replay). Tools: read_file, write_file, apply_edit, glob, grep.",
      },
    ]);

  const persona =
    options.system ??
    "You are a helpful coding agent with read_file, write_file, apply_edit, glob, grep.";
  const prompts = createSystemPromptAssembler();
  prompts.register({
    id: "base",
    order: 0,
    content: () => persona,
  });
  wireCompositionPrompts(prompts, {
    ...(options.plugins ? { plugins: options.plugins } : {}),
    reservedIds: ["base"],
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
    description:
      "Minimal: fs tools + write-intent + workspace inject + replay LLM",
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
        ...(options.resolveImage
          ? { resolveImage: options.resolveImage }
          : {}),
        compaction:
          options.compaction === false ? false : (options.compaction ?? {}),
      });
    },
    dumpConfig(patch = {}) {
      return {
        preset: presetId,
        workspaceRoot: options.workspaceRoot,
        tools: tools.list().map((t) => t.name),
        llm: llm.id,
        sessionId,
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
  description: "Minimal harness: fs tools + replay LLM",
  create: createMinimalComposition,
};
