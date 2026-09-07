import { foldPlanMode } from "@xrkseek/protocol";
import { readSessionEvents, sessionEventCount } from "@xrkseek/core-session";
import { resolveXrkHome } from "@xrkseek/server-config";
import {
  listSkillsFromWorkspace,
  loadOfficeRecipes,
  mergeRecipesById,
  type Recipe,
} from "@xrkseek/workspace";
import path from "node:path";
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
import { formatMcpInventoryText, settingsMutateFace } from "./settings-credentials.js";
import { resolveSessionCwd } from "./session-cwd.js";
import { resolveSessionModelSelection } from "./model-catalog.js";
import { selectSessionModel } from "./select-session-model.js";

export type SlashRecipesLoader = () => Promise<readonly Recipe[]> | readonly Recipe[];

/**
 * Home system recipes (`~/.xrk/recipes`, seeded by CLI) then workspace
 * `.agents/recipes` then `.xrk/recipes` (later id wins).
 */
export function defaultRecipesLoader(workspaceRoot: string): SlashRecipesLoader {
  return async () => {
    const home = resolveXrkHome();
    const homeRecipes = await loadOfficeRecipes(path.join(home, "recipes"));
    const agents = await loadOfficeRecipes(
      path.join(workspaceRoot, ".agents", "recipes"),
    );
    const product = await loadOfficeRecipes(
      path.join(workspaceRoot, ".xrk", "recipes"),
    );
    return mergeRecipesById(homeRecipes, agents, product);
  };
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
              "Switch sandbox mode + approval policy (not the session tool badge)",
            input: { hint: "<mode>" },
          },
        ]),
    ...(used.has("plan")
      ? []
      : [
          {
            name: "plan",
            description: "Enter or leave plan mode (session collaboration; not a tool badge)",
            input: { hint: "[off|message]" },
          },
        ]),
    ...(used.has("mcp")
      ? []
      : [
          {
            name: "mcp",
            description:
              "List configured MCP servers and mount status (mcp verbose for detail)",
            input: { hint: "[verbose]" },
          },
        ]),
    ...(used.has("status")
      ? []
      : [
          {
            name: "status",
            description: "Show session badge, permission, plan, theme, model, cwd",
          },
        ]),
    ...(used.has("model")
      ? []
      : [
          {
            name: "model",
            description:
              "Show or switch provider/model (Codex-style /model provider/model)",
            input: { hint: "[provider/model]" },
          },
        ]),
    ...(used.has("theme")
      ? []
      : [
          {
            name: "theme",
            description: "Set appearance preference (live): light|dark|system",
            input: { hint: "light|dark|system" },
          },
        ]),
    ...(used.has("skills")
      ? []
      : [
          {
            name: "skills",
            description: "List workspace skills",
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
  used.add("mcp");
  used.add("status");
  used.add("model");
  used.add("theme");
  used.add("skills");
  used.add("auto-review");
  used.add("compact");
  used.add("export");
  used.add("feedback");
  // Recipes stay listed for discovery; Face does not execute them — session.prompt
  // admits `/id` so assemble expands (skills/recipes). Builtins/plugins only here.
  const fromRecipes = recipes
    .filter((r) => COMMAND_NAME.test(r.id) && !used.has(r.id))
    .map((r) => {
      const hint = r.parameters.map((p) => p.name).join(" ");
      return {
        name: r.id,
        description: `${r.description ?? r.title} (expands into the prompt)`,
        ...(hint ? { input: { hint } } : {}),
      };
    });

  return [...fromPlugins, ...builtins, ...fromRecipes].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
}

/**
 * Execute a Face builtin or process `kind: commands` plugin.
 * Workspace recipes are listed but not executed here — return `undefined` so
 * `session.prompt` admits the slash line and assemble expands it.
 * Miss (syntax / unknown name) → `undefined`（不入账，与 DSH 一致）.
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
        text: `current permission mode ${current} (available: ${FACE_PERMISSION_PRESETS.join(", ")})`,
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
      text: `permission mode ${name}`,
    });
  }

  if (parsed.name === "mcp") {
    const arg = parsed.rawInput.trim().toLowerCase();
    if (arg !== "" && arg !== "verbose") {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Usage: /mcp [verbose]. Attach/edit via settings_mutate ns=mcp or Settings → Plugins.",
      });
    }
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text: formatMcpInventoryText(runtime, { verbose: arg === "verbose" }),
    });
  }

  if (parsed.name === "status") {
    if (parsed.rawInput.trim().length > 0) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Usage: /status",
      });
    }
    const events = readSessionEvents(runtime.store, sessionId);
    const badge =
      runtime.sessionAgentPresets.get(sessionId) ?? "(default)";
    const permission = permissionSelectFromEvents(events).currentValue;
    const plan = foldPlanMode(events) ? "on" : "off";
    const model = resolveSessionModelSelection(runtime, sessionId);
    const cwd = resolveSessionCwd(runtime, sessionId);
    const text = [
      `badge: ${badge}`,
      `permission: ${permission}`,
      `plan: ${plan} (toggle with /plan · /plan off)`,
      `theme: ${runtime.uiSettings.theme} (/theme light|dark|system)`,
      `model: ${model.provider}/${model.model}`,
      `cwd: ${cwd}`,
      `events: ${sessionEventCount(runtime.store, sessionId)}`,
    ].join("\n");
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text,
    });
  }

  if (parsed.name === "theme") {
    const pref = parsed.rawInput.trim().toLowerCase();
    if (pref !== "light" && pref !== "dark" && pref !== "system") {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Usage: /theme light|dark|system",
      });
    }
    const mut = await settingsMutateFace(runtime, {
      ns: "ui-theme",
      ops: [{ op: "set", path: ["preference"], value: pref }],
    });
    if (!mut.ok) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: mut.error.message,
      });
    }
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text: `Appearance ${pref} (live)`,
    });
  }

  if (parsed.name === "model") {
    const raw = parsed.rawInput.trim();
    if (!raw) {
      const model = resolveSessionModelSelection(runtime, sessionId);
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "success",
        text: `Current model: ${model.provider}/${model.model}${
          model.reasoningEffort ? ` (effort ${model.reasoningEffort})` : ""
        }\nSwitch: /model <provider>/<model>`,
      });
    }
    const slash = raw.indexOf("/");
    const provider =
      slash > 0 ? raw.slice(0, slash).trim() : raw.split(/\s+/)[0] ?? "";
    const model =
      slash > 0
        ? raw.slice(slash + 1).trim().split(/\s+/)[0] ?? ""
        : raw.split(/\s+/).slice(1).join(" ").trim();
    if (!provider || !model) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Usage: /model [provider/model]",
      });
    }
    const selected = await selectSessionModel(runtime, {
      sessionId,
      provider,
      model,
    });
    if (!selected.ok) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: selected.error.message,
      });
    }
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text: `Model set to ${selected.value.selected.provider}/${selected.value.selected.model}`,
    });
  }

  if (parsed.name === "skills") {
    if (parsed.rawInput.trim().length > 0) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "error",
        text: "Usage: /skills",
      });
    }
    const skills = await listSkillsFromWorkspace(runtime.workspaceRoot);
    if (skills.length === 0) {
      return appendCommandPair(runtime, sessionId, parsed, {
        kind: "success",
        text: "No skills found under workspace / home skill roots.",
      });
    }
    const lines = skills.map((s) => {
      const desc = s.description?.trim()
        ? ` — ${s.description.trim().slice(0, 80)}`
        : "";
      return `- ${s.name}${desc}`;
    });
    return appendCommandPair(runtime, sessionId, parsed, {
      kind: "success",
      text: `Skills (${skills.length}):\n${lines.join("\n")}`,
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

  // Recipes / unknown names: not Face commands — caller admits as text.
  return undefined;
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
