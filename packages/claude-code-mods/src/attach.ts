/**
 * Attach point for this product's runtime.
 *
 * The bridge itself (`ClaudeCodeMods`) raises events; what it cannot know is
 * *which* seams this host has. Upstream those seams were Cordis events
 * (`agent/created`, `agent/pre-step`, `tools/execute`) published by its own
 * agent and tool services. Our shipped runtime drives `core-agent` and
 * `core-tools` instead, whose extension point for per-call interception is
 * `ToolPipeline` — so this module wires the bridge onto that pipeline and
 * exposes the remaining dispatches for the seams a caller owns.
 *
 * What is wired here:
 *
 * - **`tool.call`** — through `pipeline.onPre` (refusals) and `pipeline.onPost`
 *   (result replacement), so a plugin observes and can veto every tool call the
 *   agent makes, in both directions.
 *
 * What a caller dispatches through {@link AttachedClaudeCodeMods.dispatch}:
 *
 * - `session.start` / `session.end` — wherever the host creates and disposes an
 *   agent (one call each).
 * - `prompt.submit` / `turn.start` / `turn.complete` — the same place the host
 *   admits a prompt and observes a completed turn.
 * - `command.run` / `ui.render` — raised by the command registry and the band,
 *   respectively, once those are wired; the engine serves both already.
 *
 * The bridge does not invent these calls: an unattached event is simply one no
 * plugin sees, which is the honest state rather than a silently partial one.
 * @module
 */

import type { Context } from "@xrkseek/cordis";
import type { ToolPipeline, ToolPipelineContext } from "@xrkseek/core-tools";

import ClaudeCodeMods, { type Config } from "./index.js";
import type { AgentBinding } from "./host-ops.js";
import { definePluginDir } from "./plugin-dir.js";
import type { LoadedMod } from "./chain.js";
import { createToolNameAliases, type ToolNameAliases } from "./tool-names.js";
import { record } from "./values.js";
import type { ModAgent, ToolCallInput, ToolCallResult } from "./types.js";

export interface AttachClaudeCodeModsOptions {
  readonly ctx: Context;
  /**
   * The composition's existing tool pipeline. Omitted for a host that wants the
   * bridge without tool interception (for example a `plugin validate` run).
   */
  readonly pipeline?: ToolPipeline;
  /**
   * Which agent a tool call belongs to.
   *
   * `ToolCall` carries no session identity, so this is the host's knowledge to
   * supply. Returning `undefined` is allowed: mods still see the call, but
   * `$.session.*` and `$.prompt.submit` refuse for that event because there is
   * no session to speak for.
   */
  readonly agentOf?: (context: ToolPipelineContext) => ModAgent | undefined;
  /** Plugin directories to load, in chain order. */
  readonly dirs?: readonly string[];
  /** Bridge configuration (timeouts, tool aliases). */
  readonly config?: Config;
  /**
   * Claude Code ↔ harness tool-name translation.
   *
   * A plugin's matchers and `e.tool` use Claude Code's names (`Bash`, `Read`),
   * while our registry names tools in lowercase; without translation a
   * `{ tool: 'Bash' }` matcher would never match. Defaults to the built-in table.
   */
  readonly toolAliases?: ToolNameAliases;
}

export interface AttachedClaudeCodeMods {
  /** The loaded mods in chain order. */
  readonly mods: readonly LoadedMod[];
  /**
   * Raise one engine event from a seam this module did not wire itself.
   * @param event - engine event name (`session.start`, `turn.complete`, …).
   * @param input - the payload mods receive.
   * @param fallback - the answer when no mod decides.
   * @param options - agent binding and cancellation for the dispatch.
   * @returns the chain's answer.
   */
  dispatch<I, R>(
    event: string,
    input: I,
    fallback: (input: I) => R,
    options?: { readonly agent?: ModAgent; readonly signal?: AbortSignal },
  ): Promise<R>;
  /** Undo every handler this attach installed. Loaded mods stay loaded. */
  dispose(): void;
}

/** A signal that never aborts, for a host seam that supplies none. */
const DETACHED = new AbortController().signal;

/**
 * Mount the bridge on this composition and wire `tool.call` to its pipeline.
 *
 * Mounting is `await`ed to completion: a plugin whose `register` throws must
 * fail here, at composition time, rather than half-loading and surfacing later
 * as hooks that never fire.
 */
export async function attachClaudeCodeMods(
  options: AttachClaudeCodeModsOptions,
): Promise<AttachedClaudeCodeMods> {
  const { ctx, pipeline, agentOf } = options;
  const aliases = options.toolAliases ?? createToolNameAliases();

  await ctx.plugin(ClaudeCodeMods, options.config ?? {});
  for (const dir of options.dirs ?? []) {
    await ctx.plugin(await definePluginDir(dir), {});
  }

  const bridge = ctx.claudeCodeMods;
  const disposers: (() => void)[] = [];

  const bindingOf = (context: ToolPipelineContext): AgentBinding => {
    const agent = agentOf?.(context);
    return agent === undefined ? { agent: undefined } : { agent };
  };

  if (pipeline !== undefined) {
    // Before dispatch: a mod may refuse, and its refusal becomes the tool error
    // the model reads — the same place the host's own policy denies.
    disposers.push(
      pipeline.onPre(
        async (
          context,
        ): Promise<
          { action: "continue"; args: unknown } | { action: "deny"; reason: string }
        > => {
          const input: ToolCallInput = {
            tool: aliases.toMod(context.call.name),
            tool_use_id: context.call.id,
            ...record(context.args),
          };
          const answer = await bridge.raise<ToolCallInput, ToolCallResult>(
            "tool.call",
            input,
            () => ({ result: undefined }),
            { binding: bindingOf(context), signal: context.signal ?? DETACHED },
          );
          if (answer.deny !== undefined) return { action: "deny", reason: answer.deny };
          return { action: "continue", args: context.args };
        },
      ),
    );

    // After dispatch: a mod may replace the result the model will read. `deny`
    // is meaningless here — the call already ran — so only `{ result }` is
    // honoured, and an explicit `isError` survives as a failure.
    disposers.push(
      pipeline.onPost(async (context) => {
        const input: ToolCallInput = {
          tool: aliases.toMod(context.call.name),
          tool_use_id: context.call.id,
          ...record(context.args),
        };
        const answer = await bridge.raise<ToolCallInput, ToolCallResult>(
          "tool.call",
          input,
          () => ({ result: undefined }),
          { binding: bindingOf(context), signal: context.signal ?? DETACHED },
        );
        if (answer.result === undefined) return { action: "accept" };
        return {
          action: "replace",
          content:
            typeof answer.result === "string"
              ? answer.result
              : JSON.stringify(answer.result),
          ...(answer.isError === true ? { isError: true } : {}),
        };
      }),
    );
  }

  return {
    mods: bridge.mods,
    dispatch: (event, input, fallback, dispatchOptions = {}) =>
      bridge.raise(event, input, fallback, {
        binding: {
          agent: dispatchOptions.agent,
        },
        signal: dispatchOptions.signal ?? DETACHED,
      }),
    dispose() {
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}
