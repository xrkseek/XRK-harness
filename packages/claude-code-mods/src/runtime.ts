/**
 * The bridge without Cordis.
 *
 * `ClaudeCodeMods` is a Cordis service because upstream that is how a
 * composition mounts behaviour. Our shipped runtime drives `core-agent` /
 * `core-tools` directly and has no Cordis container in the request path, so this
 * module assembles the same engine over a small service bag the host hands in.
 *
 * The Cordis-shaped pieces the engine actually touches are three: `ctx.get(name)`
 * for the services `$` reaches, `ctx.logger` for diagnostics, and `ctx.effect`
 * for teardown. `createServiceContext` supplies exactly those, so the engine,
 * chain, module and `$` code stay byte-identical to the Cordis path.
 *
 * ```ts
 * const mods = createModsRuntime({
 *   services: { fs, subprocess, commands, tools, workingDirectory, storageDomain },
 *   pipeline,
 *   dirs: ['~/.xrk/plugins/claude-code/my-plugin'],
 * })
 * ```
 * @module
 */

import type { Context } from "@xrkseek/cordis";
import type {
  ToolPipeline,
  ToolPipelineContext,
  ToolResultContent,
} from "@xrkseek/core-tools";

import { ModsEngine } from "./engine.js";
import { createHostOps, type AgentBinding } from "./host-ops.js";
import type { LoadedMod } from "./chain.js";
import { definePluginDir } from "./plugin-dir.js";
import { SurfaceTable } from "./surfaces.js";
import { createToolNameAliases, type ToolNameAliases } from "./tool-names.js";
import type {
  ModAgent,
  ModDefinition,
  SurfaceSnapshot,
  TokenMeterService,
  ToolCallInput,
  ToolCallResult,
  UiRenderInput,
  UiRenderResult,
  UserQuestionsService,
} from "./types.js";
import { messageOf, record } from "./values.js";
import type { StorageDomainService } from "./storage-domain.js";
import type { WorkingDirectoryService } from "./working-directory.js";

/** Diagnostic sink the runtime writes through. */
export interface ModsLogger {
  debug(line: string): void;
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

/**
 * Host capability `$` reaches by name.
 *
 * Every field is optional: a deployment composes what it has, and a `$` call
 * that needs an absent service fails with that service's name instead of
 * returning `undefined` into a plugin's arithmetic.
 */
export interface ModsHostServices {
  readonly fs?: unknown;
  readonly subprocess?: unknown;
  readonly commands?: unknown;
  readonly tools?: unknown;
  readonly userQuestions?: UserQuestionsService;
  readonly tokenMeter?: TokenMeterService;
  readonly storageDomain?: StorageDomainService;
  readonly workingDirectory?: WorkingDirectoryService;
}

export interface ModsRuntimeConfig {
  readonly hookTimeoutMs?: number;
  readonly catchTimeoutMs?: number;
  readonly processTimeoutMs?: number;
  readonly toolAliases?: Readonly<Record<string, string>>;
  /** Columns the AbovePrompt band reports to `ui.render`. */
  readonly bandColumns?: number;
  /** Rows the band reports as `maxRows`. */
  readonly bandRows?: number;
}

export interface CreateModsRuntimeOptions {
  readonly services: ModsHostServices;
  readonly logger?: ModsLogger;
  readonly config?: ModsRuntimeConfig;
  /** Tool interceptor install point; omit for a runtime without interception. */
  readonly pipeline?: ToolPipeline;
  /** Which agent a tool call belongs to (our `ToolCall` carries no session). */
  readonly agentOf?: (context: ToolPipelineContext) => ModAgent | undefined;
  /**
   * Resolve the agent for a band render / button press by session id.
   * The product composition has one agent per runtime; the Cordis path uses
   * the agents registry instead.
   */
  readonly agentOfSession?: (sessionId: string) => ModAgent | undefined;
  /** Plugin directories to load at startup, in chain order. */
  readonly dirs?: readonly string[];
  /** Extra diagnostics (the Cordis service logs through `ctx.logger`). */
  readonly report?: (line: string) => void;
}

export interface ModsRuntime {
  /** Loaded mods in chain order. */
  readonly mods: readonly LoadedMod[];
  /** Names of commands mods registered (for the host's inventory). */
  readonly modCommands: ReadonlySet<string>;
  /** Full names of tools mods registered. */
  readonly modTools: ReadonlySet<string>;
  /** Raise one engine event from a host seam. */
  dispatch<I, R>(
    event: string,
    input: I,
    fallback: (input: I) => R,
    options?: { readonly agent?: ModAgent; readonly signal?: AbortSignal },
  ): Promise<R>;
  /** Latest AbovePrompt snapshot (draws once when nothing was drawn yet). */
  currentBand(sessionId: string): Promise<SurfaceSnapshot>;
  /** Watch the AbovePrompt band until the signal aborts. */
  watchBand(
    sessionId: string,
    signal: AbortSignal,
  ): AsyncIterable<SurfaceSnapshot>;
  /** Run a button's `onPress` and redraw. */
  pressBand(
    sessionId: string,
    generation: number,
    actionId: string,
  ): Promise<SurfaceSnapshot>;
  /** Ask the band to redraw through `ui.render` hooks. */
  refreshBand(sessionId: string): Promise<void>;
  /** Drop a session's band (session end / agent dispose). */
  forgetBand(sessionId: string): void;
  /** Load one plugin directory into the running runtime. */
  loadDir(dir: string): Promise<LoadedMod>;
  /** Add a mod defined in code (the `defineMod` path). */
  add(definition: ModDefinition): Promise<LoadedMod>;
  /** Remove every pipeline handler and mod. */
  dispose(): Promise<void>;
}

/** A signal that never aborts, for a host seam that supplies none. */
const DETACHED = new AbortController().signal;

function consoleLogger(): ModsLogger {
  return {
    debug: (line) => console.debug(line),
    info: (line) => console.info(line),
    warn: (line) => console.warn(line),
    error: (line) => console.error(line),
  };
}

/**
 * The three Cordis members the engine uses, over a plain service bag.
 *
 * `effect` records teardown callbacks; `dispose` runs them once, in reverse
 * registration order, the way a Cordis fiber unwinds.
 */
function createServiceContext(
  services: ModsHostServices,
  logger: ModsLogger,
): { ctx: Context; dispose: () => void } {
  const teardowns: (() => void | Promise<void>)[] = [];
  const ctx = {
    get: (name: string) => (services as Record<string, unknown>)[name],
    logger,
    effect: (work: () => () => void | Promise<void>) => {
      teardowns.push(work());
    },
  };
  return {
    // The engine and host-ops only touch `get`, `logger` and `effect`; the cast
    // keeps their published signatures without dragging in Cordis.
    ctx: ctx as unknown as Context,
    dispose: () => {
      for (const teardown of teardowns.splice(0).reverse()) void teardown();
    },
  };
}

/**
 * Build a bridge runtime over the host's own services and tool pipeline.
 *
 * Loading is awaited: a plugin whose `register` throws surfaces here, at
 * composition time, rather than half-loading and becoming hooks that never fire.
 */
export async function createModsRuntime(
  options: CreateModsRuntimeOptions,
): Promise<ModsRuntime> {
  const logger = options.logger ?? consoleLogger();
  const { ctx, dispose: disposeContext } = createServiceContext(
    options.services,
    logger,
  );
  const config = options.config ?? {};
  const hookTimeoutMs = config.hookTimeoutMs ?? 10_000;
  const catchTimeoutMs = config.catchTimeoutMs ?? 1_000;
  const processTimeoutMs = config.processTimeoutMs ?? 30_000;
  const bandColumns = config.bandColumns ?? 120;
  const bandRows = config.bandRows ?? 10;
  const aliases: ToolNameAliases = createToolNameAliases(config.toolAliases);

  const report = (line: string): void => {
    // One sink, not two: a host that supplies a report channel already owns
    // logging, and echoing to the console as well printed every line twice.
    if (options.report !== undefined) options.report(line);
    else logger.warn(`claude-code-mods: ${line}`);
  };

  const registrations = new Map<string, Set<() => void>>();
  const callOrigins = new Map<string, LoadedMod>();
  const modCommands = new Set<string>();
  const modTools = new Set<string>();

  // Surfaces need the engine to raise `ui.render`; host-ops need redraw to
  // ask the band to refresh. Circular init: surfaces → engine → ops → redraw → surfaces.
  const engineSlot: { current?: ModsEngine<AgentBinding> } = {};
  const agentOfSession = (sessionId: string): ModAgent | undefined =>
    options.agentOfSession?.(sessionId);
  const surfaces = new SurfaceTable({
    columns: bandColumns,
    rows: bandRows,
    render: (sessionId, input) => {
      const agent = agentOfSession(sessionId);
      if (agent === undefined) return Promise.resolve(null);
      return engineSlot.current!.raise<UiRenderInput, UiRenderResult>(
        "ui.render",
        input,
        () => null,
        { binding: { agent }, signal: DETACHED },
      );
    },
    runAction: async (_sessionId, callback) => {
      try {
        await callback();
      } catch (error: unknown) {
        report(`a button's onPress failed: ${messageOf(error)}`);
      }
    },
    report,
  });
  // Deferred by one macrotask: a mod sets its own state right after the `$`
  // call that triggers the redraw resolves (same as the Cordis bridge).
  const redraw = (sessionId: string): void => {
    setTimeout(() => {
      if (agentOfSession(sessionId) !== undefined) void surfaces.refresh(sessionId);
    }, 0).unref?.();
  };

  const ops = createHostOps({
    ctx,
    aliases,
    processTimeoutMs,
    registrations,
    callOrigins,
    modCommands,
    modTools,
    redraw,
  });

  engineSlot.current = new ModsEngine<AgentBinding>({
    ops: (op) => ops[op],
    stateKey: (binding) => binding.agent?.session.id ?? "",
    budgetMs: hookTimeoutMs,
    catchBudgetMs: catchTimeoutMs,
    report,
    onStateRead: (key, slot) => {
      surfaces.stateRead(key, slot);
    },
    onStateWritten: (key, slot) => {
      surfaces.stateWritten(key, slot);
    },
  });
  const engine = engineSlot.current;

  const pipelineDisposers: (() => void)[] = [];

  if (options.pipeline !== undefined) {
    const pipeline = options.pipeline;
    const bindingOf = (context: ToolPipelineContext): AgentBinding => {
      const agent = options.agentOf?.(context);
      return agent === undefined ? { agent: undefined } : { agent };
    };
    const inputOf = (context: ToolPipelineContext): ToolCallInput => ({
      tool: aliases.toMod(context.call.name),
      tool_use_id: context.call.id,
      ...record(context.args),
    });

    // A `{ result }` in the pre pass means "do not run the tool, this is what the
    // model reads" — the only way a mod-supplied tool (whose registered body is
    // a placeholder that rejects) can ever answer. The pipeline's pre outcome
    // has no such arm, so the answer is parked here and settled in the execute
    // wrapper: the one seam that can skip the body without failing the call.
    const earlyAnswers = new WeakMap<ToolPipelineContext, ToolCallResult>();
    const answeredEarly = new WeakSet<ToolPipelineContext>();
    const resultContent = (
      value: unknown,
      isError: boolean | undefined,
    ): ToolResultContent => ({
      content: typeof value === "string" ? value : JSON.stringify(value),
      ...(isError === true ? { isError: true as const } : {}),
    });

    // Before dispatch: a mod may refuse; that refusal becomes the tool error the
    // model reads, in the same place the host's own policy denies.
    pipelineDisposers.push(
      pipeline.onPre(async (context) => {
        const answer = await engine.raise<ToolCallInput, ToolCallResult>(
          "tool.call",
          inputOf(context),
          () => ({ result: undefined }),
          { binding: bindingOf(context), signal: context.signal ?? DETACHED },
        );
        if (answer.deny !== undefined) return { action: "deny", reason: answer.deny };
        if (answer.result !== undefined) earlyAnswers.set(context, answer);
        return { action: "continue", args: context.args };
      }),
    );

    // Dispatch, or its cancellation: an early answer never reaches the body.
    pipelineDisposers.push(
      pipeline.onExecute(async (context, next) => {
        const early = earlyAnswers.get(context);
        if (early === undefined) {
          await next();
          return;
        }
        earlyAnswers.delete(context);
        answeredEarly.add(context);
        context.result = resultContent(early.result, early.isError);
      }),
    );

    // After dispatch: a mod may replace what the model reads. `deny` is
    // meaningless once the call has run, so only `{ result }` is honoured.
    pipelineDisposers.push(
      pipeline.onPost(async (context) => {
        // Answered before dispatch: nothing left to replace, and raising again
        // would run this call's hooks a second time.
        if (answeredEarly.delete(context)) return { action: "accept" };
        const answer = await engine.raise<ToolCallInput, ToolCallResult>(
          "tool.call",
          inputOf(context),
          () => ({ result: undefined }),
          { binding: bindingOf(context), signal: context.signal ?? DETACHED },
        );
        if (answer.result === undefined) return { action: "accept" };
        return {
          action: "replace",
          ...resultContent(answer.result, answer.isError),
        };
      }),
    );
  }

  const runtime: ModsRuntime = {
    get mods() {
      return engine.registry.list();
    },
    modCommands,
    modTools,
    dispatch: (event, input, fallback, dispatchOptions = {}) =>
      engine.raise(event, input, fallback, {
        binding: { agent: dispatchOptions.agent },
        signal: dispatchOptions.signal ?? DETACHED,
      }),
    currentBand: (sessionId) => surfaces.current(sessionId),
    watchBand: (sessionId, signal) => surfaces.watch(sessionId, signal),
    pressBand: (sessionId, generation, actionId) =>
      surfaces.press(sessionId, generation, actionId),
    refreshBand: (sessionId) => surfaces.refresh(sessionId),
    forgetBand: (sessionId) => {
      surfaces.forget(sessionId);
    },
    async loadDir(dir) {
      const plugin = await definePluginDir(dir);
      return engine.add(plugin.definition);
    },
    add: (definition) => engine.add(definition),
    async dispose() {
      for (const dispose of pipelineDisposers.splice(0)) dispose();
      for (const owned of registrations.values())
        for (const dispose of owned) dispose();
      registrations.clear();
      surfaces.dispose();
      await engine.dispose();
      disposeContext();
    },
  };

  for (const dir of options.dirs ?? []) {
    try {
      await runtime.loadDir(dir);
    } catch (error: unknown) {
      // One bad plugin must not take the composition down: name it, keep going.
      report(`plugins under ${dir} did not load: ${messageOf(error)}`);
    }
  }

  return runtime;
}
