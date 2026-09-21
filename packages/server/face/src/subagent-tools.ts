import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { SUBAGENT_ROUTING_PROMPT_TEXT } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { lastAssistantBodyText } from "./adapt/subagent-notice.js";
import { DEFAULT_MAX_ACTIVE_CHILDREN, DEFAULT_MAX_DEPTH } from "./presets-catalog.js";
import { resolveSessionCwd } from "./session-cwd.js";
import {
  ExternalAgentError,
  parseExternalAgentKind,
  runExternalAgentTurn,
  type ExternalSpawn,
} from "./external-agent-runtime.js";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  formatWorktreeResult,
  worktreeContextNote,
  worktreeSkippedForRemote,
  type SubagentWorktree,
} from "./subagent-worktree.js";

const FOREGROUND_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 50;

export { SUBAGENT_ROUTING_PROMPT_TEXT, DEFAULT_MAX_ACTIVE_CHILDREN, DEFAULT_MAX_DEPTH };
export {
  parseExternalAgentKind,
  runExternalAgentTurn,
  resolveExternalAgentLaunch,
  ExternalAgentError,
  type ExternalAgentKind,
  type ExternalSpawn,
  type RunExternalAgentOptions,
} from "./external-agent-runtime.js";

export function subagentDepth(
  runtime: FaceRuntime,
  sessionId: string,
): number {
  let depth = 0;
  let cur = sessionId;
  for (;;) {
    const link = runtime.subagents.getByChild(cur);
    if (!link) break;
    // UI/rewind forks are lineage only — they do not consume tool depth budget.
    if (link.mode !== "fork") depth += 1;
    cur = link.parentSessionId;
  }
  return depth;
}

async function waitDrainIdle(
  runtime: FaceRuntime,
  sessionId: string,
  signal?: AbortSignal,
  timeoutMs = FOREGROUND_WAIT_MS,
): Promise<void> {
  const run = runtime.drain.run?.bind(runtime.drain);
  if (run) {
    await run(sessionId);
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (runtime.drain.isActive(sessionId)) {
    if (signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    if (Date.now() > deadline) {
      throw new Error(`subagent timed out waiting for session ${sessionId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export interface BindSubagentToolsOptions {
  readonly runtime: FaceRuntime;
  readonly parentSessionId: string;
  readonly maxDepth?: number;
  /**
   * Max concurrent *active* (draining) direct children under this parent.
   * Omit → {@link DEFAULT_MAX_ACTIVE_CHILDREN} (4).
   */
  readonly maxActiveChildren?: number;
  /** Override spawn for external runtimes (tests). */
  readonly externalSpawn?: ExternalSpawn;
  /** Override env for external launch resolution (tests). */
  readonly externalEnv?: NodeJS.ProcessEnv;
}

function countActiveChildren(
  runtime: FaceRuntime,
  parentSessionId: string,
): number {
  let n = 0;
  for (const link of runtime.subagents.listDelegated(parentSessionId)) {
    if (runtime.drain.isActive(link.childSessionId)) n += 1;
  }
  return n;
}

function createSubagentTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxActiveChildren =
    options.maxActiveChildren ?? DEFAULT_MAX_ACTIVE_CHILDREN;
  return {
    name: "subagent",
    description:
      "Delegate a self-contained task to a subagent (separate session/context). " +
      "Use for focused independent work — research, a scoped implementation, analysis, or read-only review — " +
      "so it does not consume this conversation's context. " +
      "By default the child cannot see this chat — give a complete standalone prompt. " +
      "Set inherit_context true to seed the child with this session's completed turns only " +
      "(the current in-flight turn is excluded). " +
      "By default waits for the result; set run_in_background true to get a durable child id and continue later via send_message. " +
      "Optional runtime: omit or in-process (default Face child); acp / app-server / claude-code spawn an external one-shot subprocess (no Face child; background not supported).",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short (3-5 word) label for the delegated task (sidebar).",
        },
        prompt: {
          type: "string",
          description:
            "Task for the subagent. When inherit_context is false (default), include paths, goals, and constraints — it does not see this conversation. When inherit_context is true, build on the seeded completed turns.",
        },
        inherit_context: {
          type: "boolean",
          description:
            "If true, seed the child with this session's completed-turn prefix (open turn excluded). Default false. Ignored for external runtimes.",
        },
        run_in_background: {
          type: "boolean",
          description:
            "If true, return the child session id immediately (continuable). Default false (wait for the child's final answer). Not supported for external runtimes.",
        },
        runtime: {
          type: "string",
          description:
            "Delegation runtime: in-process (default), acp (XRK_ACP_AGENT), app-server (XRK_CODEX_APP_SERVER / codex app-server), claude-code (XRK_CLAUDE_CODE / claude -p).",
        },
        worktree: {
          type: "boolean",
          description:
            "If true and this session is a local git checkout, run the child in its own git worktree. " +
            "Skipped when the repo is not git or the terminal is remote. " +
            "The worktree is removed only when the child made zero commits and left the tree clean; otherwise it stays.",
        },
      },
      required: ["prompt"],
    },
    presentCall: (args) => ({
      card: "generic",
      title: String(
        (args as { description?: string }).description?.trim() || "Subagent",
      ),
      kind: "execute",
      rawInput: args,
    }),
    async execute(args, signal) {
      const a = args as {
        description?: string;
        prompt?: string;
        inherit_context?: boolean;
        run_in_background?: boolean;
        runtime?: string;
        worktree?: boolean;
      };
      const prompt = String(a.prompt ?? "").trim();
      if (!prompt) {
        return { content: "subagent: empty prompt", isError: true };
      }
      const runtimeKind = parseExternalAgentKind(a.runtime);
      if (runtimeKind === undefined) {
        return {
          content:
            "subagent: runtime must be in-process | acp | app-server | claude-code",
          isError: true,
        };
      }
      if (runtimeKind !== "in-process") {
        if (a.run_in_background === true) {
          return {
            content:
              "subagent: run_in_background is not supported for external runtimes",
            isError: true,
          };
        }
        try {
          const result = await runExternalAgentTurn({
            kind: runtimeKind,
            cwd: options.runtime.workspaceRoot,
            prompt,
            ...(signal ? { signal } : {}),
            ...(options.externalEnv ? { env: options.externalEnv } : {}),
            ...(options.externalSpawn
              ? { spawnImpl: options.externalSpawn }
              : {}),
          });
          return {
            content: `[external:${result.kind}]\n${result.text}`,
          };
        } catch (err) {
          const msg =
            err instanceof ExternalAgentError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          return { content: `subagent external: ${msg}`, isError: true };
        }
      }
      const depth = subagentDepth(
        options.runtime,
        options.parentSessionId,
      );
      if (depth >= maxDepth) {
        return {
          content: `subagent: max depth ${maxDepth} reached (current depth ${depth})`,
          isError: true,
        };
      }
      const active = countActiveChildren(
        options.runtime,
        options.parentSessionId,
      );
      if (active >= maxActiveChildren) {
        return {
          content: `subagent: max active children ${maxActiveChildren} reached (active ${active})`,
          isError: true,
        };
      }
      const background = a.run_in_background === true;
      const inherit = a.inherit_context === true;
      const label =
        String(a.description ?? "").trim() ||
        (background ? "subagent" : "subagent-task");
      const linkMode = background ? "continuable" : "one-shot";
      const parentCwd = resolveSessionCwd(
        options.runtime,
        options.parentSessionId,
      );
      let isolated: SubagentWorktree | null = null;
      let worktreeSkip = "";
      if (a.worktree === true) {
        if (worktreeSkippedForRemote(options.runtime.remoteExecution)) {
          worktreeSkip = "worktree skipped: not a local terminal";
        } else {
          isolated = createSubagentWorktree(parentCwd);
          if (!isolated) {
            worktreeSkip =
              "worktree skipped: not a git repository or worktree add failed";
          }
        }
      }
      const childPrompt = isolated
        ? `${prompt}\n\n${worktreeContextNote(isolated)}`
        : prompt;

      let childId: string;
      let seedEventCount = 0;
      if (inherit) {
        const forked = await dispatchFaceMethod(
          options.runtime,
          "session.fork",
          `tool-sa-fork-${Date.now()}`,
          {
            sessionId: options.parentSessionId,
            linkMode,
            label,
          },
        );
        if (!forked.result.ok) {
          // No completed turn yet — fall back to a fresh child (DSH fork omits seed).
          if (forked.result.error.code === "fork-unavailable") {
            const created = await dispatchFaceMethod(
              options.runtime,
              "session.create",
              `tool-sa-${Date.now()}`,
              {
                parentSessionId: options.parentSessionId,
                label,
                mode: linkMode,
              },
            );
            if (!created.result.ok) {
              if (isolated) finalizeSubagentWorktree(isolated);
              return {
                content: `subagent create failed: ${created.result.error.message}`,
                isError: true,
              };
            }
            childId = String(
              (created.result.value as { sessionId: string }).sessionId,
            );
          } else {
            if (isolated) finalizeSubagentWorktree(isolated);
            return {
              content: `subagent seed failed: ${forked.result.error.message}`,
              isError: true,
            };
          }
        } else {
          childId = String(
            (forked.result.value as { sessionId: string }).sessionId,
          );
          seedEventCount = Number(
            (forked.result.value as { eventCount?: number }).eventCount ?? 0,
          );
        }
      } else {
        const created = await dispatchFaceMethod(
          options.runtime,
          "session.create",
          `tool-sa-${Date.now()}`,
          {
            parentSessionId: options.parentSessionId,
            label,
            mode: linkMode,
          },
        );
        if (!created.result.ok) {
          if (isolated) finalizeSubagentWorktree(isolated);
          return {
            content: `subagent create failed: ${created.result.error.message}`,
            isError: true,
          };
        }
        childId = String(
          (created.result.value as { sessionId: string }).sessionId,
        );
      }
      if (isolated) {
        options.runtime.sessionCwds.set(childId, isolated.path);
        await options.runtime.invalidateAgent?.(childId);
      }
      const worktreeLine = (keep: boolean): string => {
        if (worktreeSkip) return worktreeSkip;
        if (!isolated) return "";
        if (keep) {
          return `[worktree] ${isolated.path}\nbranch ${isolated.branch}\nleft in place (child still running)`;
        }
        return formatWorktreeResult(finalizeSubagentWorktree(isolated));
      };
      const prompted = await dispatchFaceMethod(
        options.runtime,
        "session.prompt",
        `tool-sa-p-${childId}`,
        {
          sessionId: childId,
          mode: "queue",
          content: [{ type: "text", text: childPrompt }],
        },
      );
      if (!prompted.result.ok) {
        const extra = worktreeLine(false);
        return {
          content: [`subagent prompt failed: ${prompted.result.error.message}`, extra]
            .filter(Boolean)
            .join("\n"),
          isError: true,
        };
      }
      if (background) {
        return {
          content: [
            `Started background subagent \`${childId}\` (${label}).`,
            inherit
              ? "Seeded with this session's completed turns (open turn excluded)."
              : undefined,
            "Use send_message to continue, interrupt_agent to stop, list_agents to inspect.",
            "Keep working; do not busy-poll.",
            worktreeLine(true) || undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      try {
        await waitDrainIdle(options.runtime, childId, signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await dispatchFaceMethod(
          options.runtime,
          "session.cancel",
          `tool-sa-c-${childId}`,
          { sessionId: childId },
        ).catch(() => undefined);
        const extra = worktreeLine(false);
        return {
          content: [`subagent failed: ${message}`, extra].filter(Boolean).join("\n"),
          isError: true,
        };
      }
      const all = readSessionEvents(options.runtime.store, childId);
      // Never return seeded parent assistant text as the child's result.
      const owned = seedEventCount > 0 ? all.slice(seedEventCount) : all;
      const text = lastAssistantBodyText(owned);
      const extra = worktreeLine(false);
      if (!text) {
        return {
          content: [`(subagent ${childId} finished with no assistant text)`, extra]
            .filter(Boolean)
            .join("\n"),
        };
      }
      return { content: [text, extra].filter(Boolean).join("\n") };
    },
  };
}

function createListAgentsTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "list_agents",
    description:
      "List direct child subagents of this session (id, label, mode, running).",
    parameters: { type: "object", properties: {} },
    isConcurrencySafe: () => true,
    async execute() {
      const listed = await dispatchFaceMethod(
        options.runtime,
        "subagent.list",
        `tool-sa-list-${Date.now()}`,
        { parentSessionId: options.parentSessionId },
      );
      if (!listed.result.ok) {
        return {
          content: listed.result.error.message,
          isError: true,
        };
      }
      const value = listed.result.value as {
        entries?: Array<{
          kind?: string;
          id?: string;
          label?: string;
          mode?: string;
          activity?: string;
          reason?: string;
        }>;
      };
      const entries = value.entries ?? [];
      if (!entries.length) return { content: "(no subagents)" };
      return {
        content: entries
          .map((e) => {
            if (e.kind === "diagnostic") {
              return `${e.id ?? "?"}\tdiagnostic\t${e.reason ?? "unavailable"}`;
            }
            const id = e.id ?? "?";
            const label = e.label ?? "subagent";
            const mode = e.mode ?? "?";
            const activity = e.activity ?? "idle";
            return `${id}\t${label}\t${mode}\t${activity}`;
          })
          .join("\n"),
      };
    },
  };
}

function createSendMessageTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "send_message",
    description:
      "Send a follow-up to a continuable background subagent by child session id. " +
      "If the child is still working, the message waits in its inbox (does not steer the in-flight turn). " +
      "Returns delivery confirmation only — not the child's answer.",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Child session id from subagent / list_agents.",
        },
        message: { type: "string", description: "Follow-up text for the child." },
      },
      required: ["agent_id", "message"],
    },
    async execute(args) {
      const a = args as { agent_id?: string; message?: string };
      const childId = String(a.agent_id ?? "").trim();
      const message = String(a.message ?? "").trim();
      if (!childId || !message) {
        return {
          content: "send_message requires agent_id and message",
          isError: true,
        };
      }
      const prompted = await dispatchFaceMethod(
        options.runtime,
        "subagent.prompt",
        `tool-sa-sm-${childId}`,
        {
          parentSessionId: options.parentSessionId,
          childSessionId: childId,
          mode: "continuable",
          content: [{ type: "text", text: message }],
        },
      );
      if (!prompted.result.ok) {
        return {
          content: prompted.result.error.message,
          isError: true,
        };
      }
      return { content: `sent to ${childId}` };
    },
  };
}

function createInterruptAgentTool(
  options: BindSubagentToolsOptions,
): ToolDefinition {
  return {
    name: "interrupt_agent",
    description: "Interrupt a running child subagent by session id.",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Child session id from subagent / list_agents.",
        },
      },
      required: ["agent_id"],
    },
    async execute(args) {
      const childId = String(
        (args as { agent_id?: string }).agent_id ?? "",
      ).trim();
      if (!childId) {
        return { content: "interrupt_agent requires agent_id", isError: true };
      }
      const stopped = await dispatchFaceMethod(
        options.runtime,
        "subagent.interrupt",
        `tool-sa-int-${childId}`,
        {
          parentSessionId: options.parentSessionId,
          childSessionId: childId,
          mode: "continuable",
        },
      );
      if (!stopped.result.ok) {
        // one-shot children: fall back to session.cancel
        const cancelled = await dispatchFaceMethod(
          options.runtime,
          "session.cancel",
          `tool-sa-can-${childId}`,
          { sessionId: childId },
        );
        if (!cancelled.result.ok) {
          return {
            content: stopped.result.error.message,
            isError: true,
          };
        }
      }
      return { content: `interrupted ${childId}` };
    },
  };
}

/** Register model-facing subagent tools on a live Agent tool registry. */
export function bindSubagentTools(
  tools: ToolRegistry,
  options: BindSubagentToolsOptions,
): void {
  for (const tool of [
    createSubagentTool(options),
    createListAgentsTool(options),
    createSendMessageTool(options),
    createInterruptAgentTool(options),
  ]) {
    if (tools.get(tool.name)) {
      tools.replace(tool);
    } else {
      tools.register(tool);
    }
  }
}
