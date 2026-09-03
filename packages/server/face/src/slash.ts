import { foldPlanMode } from "@xrkseek/protocol";
import { readSessionEvents, sessionEventCount } from "@xrkseek/core-session";
import {
  loadOfficeRecipes,
  tryApplySlashRecipe,
  type Recipe,
} from "@xrkseek/workspace";
import type { FaceRpcResult } from "./types.js";
import type { FaceRuntime } from "./context.js";
import {
  collectFacePluginCommands,
  type FacePluginCommand,
} from "./plugin-inventory.js";
import { FACE_PERMISSION_PRESETS } from "./face-schema.js";
import {
  applyPermissionPreset,
  permissionSelectFromEvents,
} from "./permissions.js";
import {
  commitPlanMode,
  narratePlanCommand,
  planWantedFromArgs,
  previewPlanSet,
  steerPlanMessage,
} from "./plan-mode.js";
import { narrateAutoReviewCommand } from "./projections/units/auto-review.js";

export type SlashRecipesLoader = () => Promise<readonly Recipe[]> | readonly Recipe[];

export function defaultRecipesLoader(workspaceRoot: string): SlashRecipesLoader {
  return () => loadOfficeRecipes(`${workspaceRoot}/.xrk/recipes`);
}

/** DSH command name (lowercase, no slash). */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u;

export interface FaceCommandDescriptor {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string };
}

export interface FaceCommandExecution {
  readonly commandId: string;
  readonly result: {
    readonly kind: "success" | "error";
    readonly text?: string;
  };
}

/**
 * Parse `/name` + remainder without normalizing trailing input.
 * Unknown / non-command lines → undefined（与 DSH `parseCommand` 同形）.
 */
export function parseFaceCommandLine(
  line: string,
): { readonly name: string; readonly rawInput: string } | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line);
  const name = match?.[1];
  if (!name) return undefined;
  return { name, rawInput: line.slice(match[0].length) };
}

export async function listFaceCommandDescriptors(
  loadRecipes: SlashRecipesLoader | undefined,
  plugins?: FaceRuntime["plugins"],
): Promise<readonly FaceCommandDescriptor[]> {
  const pluginCommands = collectFacePluginCommands(plugins);
  const used = new Set(pluginCommands.map((c) => c.name));
  const fromPlugins: FaceCommandDescriptor[] = pluginCommands
    .filter((c) => COMMAND_NAME.test(c.name))
    .map((c) => ({
      name: c.name,
      description: c.description,
      ...(c.input ? { input: c.input } : {}),
    }));

  const recipes = loadRecipes ? await loadRecipes() : [];
  const builtins: FaceCommandDescriptor[] = [
    ...(used.has("compact")
      ? []
      : [
          {
            name: "compact",
            description: "Compact older conversation history",
          },
        ]),
    ...(used.has("export")
      ? []
      : [
          {
            name: "export",
            description: "Download this Session log as a ZIP archive",
          },
        ]),
    ...(used.has("feedback")
      ? []
      : [
          {
            name: "feedback",
            description: "Record feedback about this session",
            input: { hint: "<text>" },
          },
        ]),
    ...(used.has("goal")
      ? []
      : [
          {
            name: "goal",
            description: "Set or replace the session goal",
            input: { hint: "objective" },
          },
        ]),
    ...(used.has("permission")
      ? []
      : [
          {
            name: "permission",
            description:
              "Switch the permission preset (sandbox mode + approval policy)",
            input: { hint: "<preset>" },
          },
        ]),
    ...(used.has("plan")
      ? []
      : [
          {
            name: "plan",
            description: "Enter or leave plan mode",
            input: { hint: "[off|message]" },
          },
        ]),
    ...(used.has("auto-review")
      ? []
      : [
          {
            name: "auto-review",
            description: "Toggle AI auto-review or approve a denied retry",
            input: { hint: "on|off|approve <n>" },
          },
        ]),
  ];
  used.add("goal");
  used.add("permission");
  used.add("plan");
  used.add("auto-review");
  used.add("compact");
  used.add("export");
  used.add("feedback");
  const fromRecipes = recipes
    .filter((r) => COMMAND_NAME.test(r.id) && !used.has(r.id))
    .map((r) => {
      const hint = r.parameters.map((p) => p.name).join(" ");
      return {
        name: r.id,
        description: r.description ?? r.title,
        ...(hint ? { input: { hint } } : {}),
      };
    });

  return [...fromPlugins, ...builtins, ...fromRecipes].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
}

/**
 * Execute a slash line: plugin command (first) or workspace recipe → log
 * `command/run`+`command/done`. Miss (syntax / unknown name) → `undefined`
 *（不入账，与 DSH 一致）.
 */
export async function executeFaceCommand(
  runtime: FaceRuntime,
  sessionId: string,
  line: string,
): Promise<FaceCommandExecution | undefined> {
  const parsed = parseFaceCommandLine(line);
  if (!parsed) return undefined;

  const pluginHit = collectFacePluginCommands(runtime.plugins).find(
    (c) => c.name === parsed.name,
  );
  if (pluginHit) {
    return settlePluginCommand(runtime, sessionId, parsed, pluginHit);
  }

  if (parsed.name === "goal") {
    const created = runtime.goals.create(sessionId, parsed.rawInput);
    if (!created.ok) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: created.error.message,
      });
    }
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text: `goal ${created.value.ref.id}`,
    });
  }

  if (parsed.name === "permission") {
    const name = parsed.rawInput.trim();
    if (name === "") {
      const current = permissionSelectFromEvents(
        readSessionEvents(runtime.store, sessionId),
      ).currentValue;
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "success",
        text: `current preset ${current} (available: ${FACE_PERMISSION_PRESETS.join(", ")})`,
      });
    }
    const applied = applyPermissionPreset(runtime.store, sessionId, name, {
      ...(runtime.hasPtyActivity
        ? { hasPtyActivity: () => runtime.hasPtyActivity!() }
        : {}),
    });
    if (!applied.ok) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: applied.message,
      });
    }
    if (applied.changed) {
      await runtime.invalidateAgent?.(sessionId);
    }
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text: `preset ${name}`,
    });
  }

  if (parsed.name === "auto-review") {
    const snap = runtime.projections.snapshot(sessionId) as {
      autoReview?: { enabled?: boolean };
    };
    const current = snap.autoReview;
    const enabledBefore = current?.enabled ?? false;
    const text = narrateAutoReviewCommand(parsed.rawInput, enabledBefore);
    runtime.autoReviewSlashPersist?.(parsed.rawInput);
    return appendCommandPair(
      runtime,
      sessionId,
      parsed,
      { kind: "success", text },
      undefined,
      parsed.rawInput,
    );
  }

  if (parsed.name === "plan") {
    const wanted = planWantedFromArgs(parsed.rawInput);
    const events = readSessionEvents(runtime.store, sessionId);
    const loggedActive = foldPlanMode(events);
    const outcome = previewPlanSet(events, wanted);
    const text = narratePlanCommand(outcome, wanted, loggedActive);
    const execution = appendCommandPair(
      runtime,
      sessionId,
      parsed,
      { kind: "success", text },
      undefined,
      parsed.rawInput,
    );
    if (outcome === "committed") {
      commitPlanMode(runtime.store, sessionId, wanted);
    }
    if (steerPlanMessage(runtime.store, sessionId, parsed.rawInput)) {
      runtime.drain.wake(sessionId);
    }
    return execution;
  }

  if (parsed.name === "export") {
    if (parsed.rawInput.trim().length > 0) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "The Web /export command does not accept a path.",
      });
    }
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text: "Session log download requested.",
    });
  }

  if (parsed.name === "feedback") {
    const text = parsed.rawInput.trim();
    if (!text) {
      return appendCommandPair(
        runtime,
        sessionId,
        parsed,
        {
          kind: "error",
          text: "Feedback text is required. Usage: /feedback <text>",
        },
        undefined,
        null,
      );
    }
    if (text.length > 8192) {
      return appendCommandPair(
        runtime,
        sessionId,
        parsed,
        {
          kind: "error",
          text: "Feedback text must be at most 8192 characters.",
        },
        undefined,
        null,
      );
    }
    const commandId = mintCommandId();
    const ts = Date.now();
    runtime.store.append(sessionId, {
      type: "command/run",
      ts,
      commandId,
      name: "feedback",
      source: { kind: "user" },
    });
    runtime.store.append(sessionId, {
      type: "feedback/record",
      ts: ts + 1,
      text,
    });
    const summarySeq = sessionEventCount(runtime.store, sessionId);
    runtime.store.append(sessionId, {
      type: "command/done",
      ts: ts + 2,
      commandId,
      kind: "success",
      text: `Feedback recorded for session ${sessionId}. Session sharing is not configured.`,
      sourceEventSeq: summarySeq,
    });
    return {
      commandId,
      result: {
        kind: "success",
        text: `Feedback recorded for session ${sessionId}. Session sharing is not configured.`,
      },
    };
  }

  if (parsed.name === "compact") {
    if (parsed.rawInput.trim().length > 0) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Usage: /compact (no arguments)",
      });
    }
    const agent = await runtime.resolveAgent(sessionId);
    if (agent.isBusy()) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Compaction is unavailable because this process has an active compaction, or the agent is not idle.",
      });
    }
    if (!agent.compactNow) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Compaction is unavailable on this agent.",
      });
    }
    try {
      const out = await agent.compactNow();
      if (!out.compacted) {
        const text =
          out.reason === "busy"
            ? "Compaction is unavailable because this process has an active compaction, or the agent is not idle."
            : out.reason === "summary"
              ? "Compaction could not produce a useful summary. The conversation is unchanged."
              : "No compactable history yet.";
        return appendCommandPair(runtime, sessionId, parsed, {
          kind: out.reason === "empty" ? "success" : "error",
          text,
        });
      }
      return appendCommandPair(
        runtime,
        sessionId,
        parsed,
        {
          kind: "success",
          text: `Compacted ${out.shadowedMessages ?? 0} history items (~${out.shadowedTokens ?? 0} tokens).`,
        },
        undefined,
        undefined,
        out.summarySeq,
      );
    } catch (err) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const recipes = runtime.loadSlashRecipes
    ? await runtime.loadSlashRecipes()
    : [];
  const hit = tryApplySlashRecipe(`/${parsed.name}${parsed.rawInput}`, recipes);
  if (!hit) return undefined;

  return appendCommandPair(runtime, sessionId, parsed, {
    kind: "success",
    text: hit.userPrompt,
  });
}

function mintCommandId(): string {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function settlePluginCommand(
  runtime: FaceRuntime,
  sessionId: string,
  parsed: { readonly name: string; readonly rawInput: string },
  command: FacePluginCommand,
): Promise<FaceCommandExecution> {
  const commandId = mintCommandId();
  let result: { kind: "success" | "error"; text?: string };
  try {
    result = await command.handler({
      sessionId,
      rawInput: parsed.rawInput,
      commandId,
    });
  } catch (err) {
    result = {
      kind: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  }
  return appendCommandPair(runtime, sessionId, parsed, result, commandId);
}

function appendCommandPair(
  runtime: FaceRuntime,
  sessionId: string,
  parsed: { readonly name: string; readonly rawInput: string },
  result: { kind: "success" | "error"; text?: string },
  commandId?: string,
  args?: string | null,
  sourceEventSeq?: number,
): FaceCommandExecution {
  const id = commandId ?? mintCommandId();
  const ts = Date.now();
  const recorded =
    args === null
      ? undefined
      : args !== undefined
        ? args
        : parsed.rawInput
          ? parsed.rawInput
          : undefined;
  runtime.store.append(sessionId, {
    type: "command/run",
    ts,
    commandId: id,
    name: parsed.name,
    source: { kind: "user" },
    ...(recorded !== undefined ? { args: recorded } : {}),
  });
  runtime.store.append(sessionId, {
    type: "command/done",
    ts: ts + 1,
    commandId: id,
    kind: result.kind,
    ...(result.text !== undefined ? { text: result.text } : {}),
    ...(sourceEventSeq !== undefined ? { sourceEventSeq } : {}),
  });
  return { commandId: id, result };
}

/**
 * Face-level slash on `session.prompt`.
 * DSH unary value only allows `command.kind: "success"` — unknown `/name`
 * is not a command (admit as text). Failed known command → `command-error`.
 */
export async function tryFaceSlashCommand(
  runtime: FaceRuntime,
  sessionId: string,
  text: string,
): Promise<FaceRpcResult<{
  accepted: true;
  command?: { kind: "success"; text?: string };
}> | undefined> {
  const trimmed = text.trim();
  if (!parseFaceCommandLine(trimmed)) return undefined;
  const execution = await executeFaceCommand(runtime, sessionId, trimmed);
  if (!execution) return undefined;
  if (execution.result.kind === "error") {
    return {
      ok: false,
      error: {
        code: "command-error",
        message: execution.result.text ?? "command failed",
      },
    };
  }
  return {
    ok: true,
    value: {
      accepted: true,
      command: {
        kind: "success",
        ...(execution.result.text !== undefined
          ? { text: execution.result.text }
          : {}),
      },
    },
  };
}
