/**
 * Claude Code plugins inside the harness composition.
 *
 * The composition owns the three things the bridge needs and the bridge cannot
 * discover for itself: the tool pipeline, the filesystem seam, and the session
 * identity. This module is the only place that knows all three, so it is where
 * a plugin directory becomes live behaviour.
 *
 * Lifecycle, matching the reference host:
 *
 * - `ensure()` — find installed plugins and build the runtime. Lazy and
 *   idempotent, called from `createAgent()`; a composition with no plugins
 *   installed does no work at all.
 * - `attach(handle)` — once per agent, raises `session.start` before the first
 *   prompt.
 * - `wrap(handle)` — `continueTurn` raises `prompt.submit` (a plugin may rewrite
 *   the text or drop the prompt), then `turn.start`, then `turn.complete`.
 * - `dispose()` — raises `session.end` while `$.state` is still readable, then
 *   unloads.
 *
 * A plugin failure never fails a turn: every dispatch is awaited but its errors
 * are reported and swallowed, because a broken third-party hook must not stop
 * the user's conversation.
 * @module
 */

import path from "node:path";

import {
  createModsRuntime,
  createProductAgent,
  createJsonStorageDomain,
  createSessionWorkingDirectory,
  discoverClaudeCodePluginDirs,
  type ModAgent,
  type ModsRuntime,
  type UserQuestionsService,
} from "@xrkseek/claude-code-mods";
import type {
  AgentHandle,
  PluginBandSource,
  PluginCommandDescriptor,
  PluginCommandSource,
} from "@xrkseek/core-agent";
import {
  deriveMessages,
  foldRequestHeader,
  readSessionEvents,
  type SessionStore,
} from "@xrkseek/core-session";
import type { ToolPipeline, ToolRegistry } from "@xrkseek/core-tools";
import type { FsService } from "@xrkseek/exec-fs";

/** A signal that never aborts, for dispatches the host does not cancel. */
const DETACHED = new AbortController().signal;

export interface HarnessModsOptions {
  readonly pipeline: ToolPipeline;
  /** The composition's tool registry — `$.tool.*` acts on this one, not a copy. */
  readonly tools?: ToolRegistry;
  readonly fs: FsService;
  /** Shared with the shell tools so a plugin's `$.process.run` is the same runner. */
  readonly subprocess?: unknown;
  readonly sessionId: string;
  /** The composition's session log — `$.session.messages` / `turns` fold it. */
  readonly store: SessionStore;
  /** Active route's model id, for `$.session.model`. */
  readonly model?: string;
  /** Absolute workspace root; also `$.session.cwd` and the `$.fs` root. */
  readonly workspaceRoot: string;
  /** Directory holding installed Claude Code plugins. */
  readonly pluginsRoot: string;
  /**
   * Face (or Cordis) answerer for `$.ui.ask`. When set, `session.start` reports
   * `isInteractive: true` and plugins can block on a human reply.
   */
  readonly userQuestions?: UserQuestionsService;
  /** Diagnostics sink (Host log). */
  readonly report?: (line: string) => void;
}

export interface HarnessMods {
  /** The live runtime, once `ensure()` has resolved one. */
  runtime(): ModsRuntime | undefined;
  /** Load plugins (idempotent). Returns undefined when none are installed. */
  ensure(): Promise<ModsRuntime | undefined>;
  /** Raise `session.start` for this agent. */
  attach(handle: AgentHandle): Promise<void>;
  /** Wrap a handle so prompts and turns are published to plugins. */
  wrap(handle: AgentHandle): AgentHandle;
  /** Raise `session.end` and unload everything. */
  dispose(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The command table `$.command.*` acts on.
 *
 * The product has no command registry of its own — Face dispatches slash
 * commands from a fixed table built at load time — so the bridge owns one here:
 * `$.command.register` lands in this map, `$.command.list` reads it, and
 * `$.command.run` resolves a `/name args` line through it, which is what raises
 * `command.run` for the plugin that registered the name.
 *
 * The same table is what `wrap()` publishes on the handle as
 * `pluginCommands`, so Face lists these in the `/` panel and a typed `/name`
 * dispatches here — one source of truth, not a second registry.
 */
function commandsFacade(options: {
  readonly store: SessionStore;
  readonly sessionId: string;
}) {
  type Entry = {
    readonly description: string;
    readonly input?: { readonly hint: string };
    readonly handler: (invocation: {
      readonly rawInput: string;
      readonly agent?: unknown;
      readonly signal?: AbortSignal;
    }) => Promise<{ readonly kind: "success" | "error"; readonly text?: string }>;
  };
  const registered = new Map<string, Entry>();

  return {
    register: (definition: {
      readonly name: string;
      readonly description: string;
      readonly input?: { readonly hint: string };
      readonly handler: Entry["handler"];
    }) => {
      registered.set(definition.name, {
        description: definition.description,
        ...(definition.input === undefined ? {} : { input: definition.input }),
        handler: definition.handler,
      });
      return () => {
        registered.delete(definition.name);
      };
    },
    list: (): readonly PluginCommandDescriptor[] =>
      [...registered].map(([name, entry]) => ({
        name,
        description: entry.description,
        ...(entry.input === undefined ? {} : { input: entry.input }),
      })),
    execute: async (agent: unknown, line: string, signal: AbortSignal | undefined) => {
      const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line);
      if (match === null) return undefined;
      const name = match[1] ?? "";
      if (name === "") return undefined;
      const entry = registered.get(name);
      if (entry === undefined) return undefined;
      // The separator is not part of the arguments: a handler that does not
      // trim would otherwise see `/say   hello` as `"   hello"` and echo the
      // padding back to the user.
      const rawInput = line.slice(match[0].length).replace(/^[\t\n\r ]+/u, "");
      const commandId = `cmd_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      // Log-only pair, the same shape Face appends for a typed command, so
      // `$.command.run` leaves the same trail in the session log as `/name`.
      options.store.append(options.sessionId, {
        type: "command/run",
        ts: Date.now(),
        commandId,
        name,
        source: { kind: "user" },
        ...(rawInput.length > 0 ? { args: rawInput } : {}),
      });
      let result: { kind: "success" | "error"; text?: string };
      try {
        result = await entry.handler({
          rawInput,
          ...(agent === undefined ? {} : { agent }),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error: unknown) {
        // A throwing handler still closes the pair below — a `command/run`
        // with no `command/done` would read as a command stuck running.
        result = { kind: "error", text: messageOf(error) };
      }
      options.store.append(options.sessionId, {
        type: "command/done",
        ts: Date.now(),
        commandId,
        kind: result.kind,
        ...(result.text === undefined ? {} : { text: result.text }),
      });
      return { commandId, result };
    },
  };
}

/**
 * Present the composition's tool registry as the shape `$` reads.
 *
 * Three members, three different reasons:
 *
 * - `schemas` — `$.tool.list` needs `{ name, description }` pairs; the registry
 *   has full definitions, and handing those over would leak `execute` to a mod.
 * - `register` — `$.tool.register` stores a definition and expects a disposer
 *   back (the runtime tracks it per session). The bridge's definition also
 *   carries an `output` hint the product schema has no field for, so only the
 *   four stored fields are adopted.
 * - `execute` — the product registry has no `execute`: every call goes through
 *   the pipeline so policy, sandbox and hooks all see it. `$.tool.call` from a
 *   mod therefore runs the pipeline and returns only the model-facing text.
 */
function toolsFacade(tools: ToolRegistry, pipeline: ToolPipeline) {
  return {
    schemas: () =>
      tools.list().map((tool) => ({ name: tool.name, description: tool.description })),
    register: (definition: {
      readonly name: string;
      readonly description: string;
      readonly parameters: Record<string, unknown>;
      execute(...args: never[]): Promise<unknown>;
    }) => {
      const adopted = {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        // Wrapped rather than passed by reference: the registry stores this
        // function and calls it detached from the definition object.
        execute: (...args: never[]) => definition.execute(...args),
      };
      tools.register(adopted as never);
      return () => {
        tools.unregister(adopted.name);
      };
    },
    execute: async (call: {
      readonly callId: string;
      readonly name: string;
      readonly arguments: unknown;
      readonly signal?: AbortSignal;
    }) => {
      const definition = tools.get(call.name);
      if (definition === undefined) {
        throw new Error(`$.tool.call: no tool named ${call.name}`);
      }
      const outcome = await pipeline.run(
        definition,
        {
          id: call.callId,
          name: call.name,
          arguments: call.arguments,
        },
        call.signal,
        {},
      );
      const text =
        typeof outcome.result.content === "string"
          ? outcome.result.content
          : JSON.stringify(outcome.result.content);
      // Deferred contexts are dropped: they are typed as user messages from the
      // other runtime, and a mod reading a tool result does not need them.
      return outcome.result.isError === true
        ? { isError: true, error: { message: text }, content: [{ type: "text", text }] }
        : { isError: false, value: text, content: [{ type: "text", text }] };
    },
  };
}

/**
 * The transcript as `session.*` reads it.
 *
 * `deriveMessages` is the product's own fold from the append-only log, so a mod
 * sees exactly what the model saw (compaction included) rather than a second
 * reading of the same events. Only the two block kinds a mod can use are kept:
 * prose, and the calls the assistant made.
 */
function transcriptOf(
  store: SessionStore,
  sessionId: string,
): readonly { role: string; content: readonly unknown[] }[] {
  const out: { role: string; content: readonly unknown[] }[] = [];
  for (const message of deriveMessages(readSessionEvents(store, sessionId))) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const blocks: unknown[] =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : [...message.content];
    if (message.role === "assistant" && message.toolCalls !== undefined) {
      for (const call of message.toolCalls) {
        blocks.push({
          type: "tool-call",
          id: call.id,
          name: call.name,
          // The shape `session.messages` parses: a JSON string, not an object.
          arguments:
            typeof call.arguments === "string"
              ? call.arguments
              : JSON.stringify(call.arguments ?? {}),
        });
      }
    }
    out.push({ role: message.role, content: blocks });
  }
  return out;
}

/**
 * Present a product `AgentHandle` as the structural agent `$` reads.
 *
 * `followup` is wired to `admit` because that is how this runtime records a
 * user message without starting a turn — which is exactly what `$.prompt.submit`
 * means. `inject` is left absent: the handle has no seam for seeding model
 * context, so a deferred tool hint is dropped rather than faked.
 */
function agentFor(handle: AgentHandle, options: HarnessModsOptions): ModAgent {
  // The session log is the only clock: `SessionRecord` carries no createdAt,
  // and inventing `Date.now()` here would make every session look minutes old.
  const createdAt = firstEventTs(options.store, options.sessionId);
  return createProductAgent({
    sessionId: options.sessionId,
    cwd: options.workspaceRoot,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(createdAt === undefined ? {} : { createdAt }),
    messages: () => transcriptOf(options.store, options.sessionId),
    followup: (message) => {
      const content = (message as { content?: unknown }).content;
      if (content === undefined) return;
      handle.admit(content as never);
    },
  });
}

/** The first durable event's timestamp, or undefined for a blank session. */
function firstEventTs(store: SessionStore, sessionId: string): number | undefined {
  return readSessionEvents(store, sessionId)[0]?.ts;
}

/**
 * Tokens the session has spent, summed from the provider samples the log
 * already holds.
 *
 * `undefined` for a session with no samples yet: `$.session.usage` then reports
 * `context.tokens` as absent, which is the truth. Reporting `0` would read as
 * "this session is free".
 */
function tokensSoFar(store: SessionStore, sessionId: string): number | undefined {
  let total = 0;
  let sampled = false;
  for (const event of readSessionEvents(store, sessionId)) {
    if (event.type !== "assistant/message" || event.usage === undefined) continue;
    sampled = true;
    total +=
      event.usage.totalTokens ?? event.usage.inputTokens + event.usage.outputTokens;
  }
  return sampled ? total : undefined;
}

/**
 * The context window the last request actually ran against.
 *
 * `request/header` carries the route's `contextWindow`, so this is a real
 * number whenever the model advertised one — no second catalog to drift from
 * what the model was told. Absent (not `0`) when no request has been made.
 */
function windowOf(store: SessionStore, sessionId: string): number | undefined {
  const header = foldRequestHeader(readSessionEvents(store, sessionId));
  const window =
    header?.config.contextWindow !== undefined
      ? header.config.contextWindow
      : undefined;
  return typeof window === "number" && window > 0 ? window : undefined;
}

export function createHarnessMods(options: HarnessModsOptions): HarnessMods {
  let loading: Promise<ModsRuntime | undefined> | undefined;
  let live: ModsRuntime | undefined;
  let agent: ModAgent | undefined;
  let turns = 0;
  // One table for the whole composition: `$.command.register` writes here,
  // `$.command.list` / `$.command.run` read it, and `wrap()` hands the same
  // table to Face so a typed `/name` reaches it too.
  const commands = commandsFacade({
    store: options.store,
    sessionId: options.sessionId,
  });

  const report = (line: string): void => {
    options.report?.(line);
  };

  /** Swallow dispatch failures: a broken plugin must not break the turn. */
  const publish = async <I, R>(
    event: string,
    input: I,
    fallback: (input: I) => R,
    signal: AbortSignal = DETACHED,
  ): Promise<R | undefined> => {
    if (live === undefined || agent === undefined) return undefined;
    try {
      return await live.dispatch(event, input, fallback, { agent, signal });
    } catch (error: unknown) {
      report(`claude-code-mods: ${event} hook failed: ${messageOf(error)}`);
      return undefined;
    }
  };

  const ensure = (): Promise<ModsRuntime | undefined> => {
    loading ??= (async () => {
      const dirs = await discoverClaudeCodePluginDirs(options.pluginsRoot);
      if (dirs.length === 0) return undefined;
      const runtime = await createModsRuntime({
        services: {
          fs: options.fs,
          ...(options.subprocess === undefined
            ? {}
            : { subprocess: options.subprocess }),
          workingDirectory: createSessionWorkingDirectory(),
          // `$.store` needs a domain service to exist. Keeping the files inside
          // the plugin root puts a plugin's own state next to the plugin, and
          // the loader skips dot-directories, so `.state` is never mistaken for
          // a plugin.
          storageDomain: createJsonStorageDomain({
            root: path.join(options.pluginsRoot, ".state"),
          }),
          ...(options.tools === undefined
            ? {}
            : { tools: toolsFacade(options.tools, options.pipeline) }),
          // `$.session.usage` asks the meter for two numbers; this composition
          // has exactly one session, so the store is the meter. Each half is
          // absent on its own: no samples yet means no `tokens`, and no
          // `request/header` yet means no `window`.
          tokenMeter: {
            measure: () => {
              const totalTokens = tokensSoFar(options.store, options.sessionId);
              const window = windowOf(options.store, options.sessionId);
              return {
                ...(totalTokens === undefined ? {} : { totalTokens }),
                ...(window === undefined ? {} : { window }),
              };
            },
          },
          commands,
          ...(options.userQuestions === undefined
            ? {}
            : { userQuestions: options.userQuestions }),
        },
        pipeline: options.pipeline,
        agentOf: () => agent,
        // Band render / press resolve the same single agent this composition owns.
        agentOfSession: (sessionId) =>
          agent !== undefined && agent.session.id === sessionId
            ? agent
            : undefined,
        dirs,
        report,
      });
      live = runtime;
      report(
        `claude-code-mods: ${runtime.mods.length} plugin(s) loaded from ${options.pluginsRoot}`,
      );
      return runtime;
    })().catch((error: unknown) => {
      report(`claude-code-mods: plugins did not load: ${messageOf(error)}`);
      return undefined;
    });
    return loading;
  };

  return {
    runtime: () => live,

    ensure,

    async attach(handle) {
      const runtime = await ensure();
      if (runtime === undefined) return;
      agent = agentFor(handle, options);
      await publish(
        "session.start",
        {
          cwd: options.workspaceRoot,
          // Product shell draws the AbovePrompt band; plugins that branch on
          // `surface` see a non-null host once the band is live.
          surface: "web",
          // True only when a Face/Cordis answerer was composed — otherwise a
          // mod that degrades on `isInteractive` correctly skips `$.ui.ask`.
          isInteractive: options.userQuestions !== undefined,
        },
        (event) => ({ cwd: event.cwd }),
      );
      // First draw after hooks registered in session.start.
      void runtime.refreshBand(options.sessionId);
    },

    wrap(handle) {
      // Prototype delegation: every other `AgentHandle` member stays the real
      // one, so this wrapper cannot drift out of sync as the handle grows.
      const wrapped = Object.create(handle) as AgentHandle;
      wrapped.continueTurn = async (input) => {
        const signal = input?.signal ?? DETACHED;
        let text = input?.text;

        if (text !== undefined) {
          const decision = await publish(
            "prompt.submit",
            {
              text,
              wait: true,
              origin: { kind: "composer" as const },
            },
            // The fallback seeds the shape, so a hook's `context` is typed too
            // rather than arriving as an unknown extra property.
            (event): { text: string; context?: readonly string[] } => ({
              text: event.text,
            }),
            signal,
          );
          if (
            decision !== undefined &&
            "drop" in decision &&
            decision.drop !== undefined
          ) {
            // A plugin dropped the prompt: report an empty turn rather than
            // running the model on text the plugin refused.
            return { text: "", turnId: "", steps: 0 };
          }
          if (decision !== undefined && decision.text !== undefined)
            text = decision.text;
          if (
            decision !== undefined &&
            "context" in decision &&
            decision.context !== undefined &&
            decision.context.length > 0
          ) {
            // Model-only text has no seam in this composition: the prompt is one
            // string, and folding the context into it would show the user words
            // they never typed. Name the drop instead of letting a plugin
            // believe its guidance reached the model.
            report(
              `claude-code-mods: prompt.submit returned ${decision.context.length} context block(s), which this composition cannot carry (no model-only prompt seam); dropped`,
            );
          }
        }

        turns += 1;
        const turnId = `mods-turn-${turns}`;
        await publish(
          "turn.start",
          { text: text ?? "", turnId },
          (event) => ({ turnId: event.turnId }),
          signal,
        );

        const startedAt = Date.now();
        let result;
        try {
          result = await handle.continueTurn(
            text === undefined ? input : { ...input, text },
          );
        } catch (error: unknown) {
          // Publish the failed turn before rethrowing: a plugin watching turn
          // boundaries must not see a turn begin and never end.
          await publish(
            "turn.complete",
            {
              turnId,
              answer: "",
              durationMs: Date.now() - startedAt,
              isAborted: false,
              reason: "error" as const,
            },
            () => ({}),
            signal,
          );
          throw error;
        }

        await publish(
          "turn.complete",
          {
            turnId,
            answer: result.text,
            durationMs: Date.now() - startedAt,
            isAborted: false,
            reason: "answer" as const,
          },
          () => ({}),
          signal,
        );
        return result;
      };
      // `run` is the deprecated alias and closes over the *unwrapped*
      // `continueTurn`, so overriding only `continueTurn` would let a caller
      // that still uses `run` skip every plugin seam. Route it back through the
      // wrapped method.
      wrapped.run = (input) => {
        if (!input.text?.trim()) {
          throw new Error("run() requires text; use continueTurn() to promote admits");
        }
        return wrapped.continueTurn(input);
      };
      // Face reads this to merge plugin commands into the `/` panel and to
      // dispatch a typed `/name`. Defined rather than assigned because the
      // handoff is one-shot: nothing may rebind the table mid-session.
      Object.defineProperty(wrapped, "pluginCommands", {
        value: {
          list: () => commands.list(),
          // Same call Face would make to a registry: the facade appends the
          // lifecycle pair itself and reports its id, so Face records nothing
          // twice.
          execute: async (line: string, signal?: AbortSignal) =>
            commands.execute(agent, line, signal),
        } satisfies PluginCommandSource,
        enumerable: true,
      });
      // AbovePrompt band: Face watches snapshots and forwards button presses.
      // Always defined on the wrapper — methods no-op / empty until `ensure`
      // has loaded a runtime (same posture as pluginCommands after wrap).
      Object.defineProperty(wrapped, "pluginBand", {
        value: {
          current: async () => {
            const runtime = live;
            if (runtime === undefined)
              return { generation: 0, tree: null };
            return runtime.currentBand(options.sessionId);
          },
          watch: (signal) => {
            const runtime = live;
            if (runtime === undefined) {
              return (async function* () {
                yield { generation: 0, tree: null };
              })();
            }
            return runtime.watchBand(options.sessionId, signal);
          },
          press: async (generation, actionId) => {
            const runtime = live;
            if (runtime === undefined)
              return { generation: 0, tree: null };
            return runtime.pressBand(
              options.sessionId,
              generation,
              actionId,
            );
          },
        } satisfies PluginBandSource,
        enumerable: true,
      });
      return wrapped;
    },

    async dispose() {
      if (live === undefined) return;
      await publish(
        "session.end",
        { reason: "other" as const, sessionId: options.sessionId },
        () => ({}),
      );
      const runtime = live;
      live = undefined;
      agent = undefined;
      try {
        runtime.forgetBand(options.sessionId);
        await runtime.dispose();
      } catch (error: unknown) {
        report(`claude-code-mods: unload failed: ${messageOf(error)}`);
      }
    },
  };
}
