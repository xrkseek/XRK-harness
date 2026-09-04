import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { SUBAGENT_ROUTING_PROMPT_TEXT } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import type { SessionEvent } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { DEFAULT_MAX_ACTIVE_CHILDREN } from "./presets-catalog.js";

const DEFAULT_MAX_DEPTH = 3;
const FOREGROUND_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 50;

export { SUBAGENT_ROUTING_PROMPT_TEXT, DEFAULT_MAX_ACTIVE_CHILDREN };

export function subagentDepth(
  runtime: FaceRuntime,
  sessionId: string,
): number {
  let depth = 0;
  let cur = sessionId;
  for (;;) {
    const link = runtime.subagents.getByChild(cur);
    if (!link) break;
    depth += 1;
    cur = link.parentSessionId;
  }
  return depth;
}

function lastAssistantText(events: readonly SessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "assistant/message") {
      const text = String(ev.content ?? "").trim();
      if (text) return text;
    }
  }
  return "";
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
}

function countActiveChildren(
  runtime: FaceRuntime,
  parentSessionId: string,
): number {
  let n = 0;
  for (const link of runtime.subagents.list(parentSessionId)) {
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
      "Give a complete standalone prompt (the child cannot see this chat). " +
      "By default waits for the result; set run_in_background true to get a durable child id and continue later via send_message.",
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
            "Complete self-contained task for the subagent. Include paths, goals, and constraints; it does not see this conversation.",
        },
        run_in_background: {
          type: "boolean",
          description:
            "If true, return the child session id immediately (continuable). Default false (wait for the child's final answer).",
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
        run_in_background?: boolean;
      };
      const prompt = String(a.prompt ?? "").trim();
      if (!prompt) {
        return { content: "subagent: empty prompt", isError: true };
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
      const label =
        String(a.description ?? "").trim() ||
        (background ? "subagent" : "subagent-task");
      const created = await dispatchFaceMethod(
        options.runtime,
        "session.create",
        `tool-sa-${Date.now()}`,
        {
          parentSessionId: options.parentSessionId,
          label,
          mode: background ? "continuable" : "one-shot",
        },
      );
      if (!created.result.ok) {
        return {
          content: `subagent create failed: ${created.result.error.message}`,
          isError: true,
        };
      }
      const childId = String(
        (created.result.value as { sessionId: string }).sessionId,
      );
      const prompted = await dispatchFaceMethod(
        options.runtime,
        "session.prompt",
        `tool-sa-p-${childId}`,
        {
          sessionId: childId,
          mode: "queue",
          content: [{ type: "text", text: prompt }],
        },
      );
      if (!prompted.result.ok) {
        return {
          content: `subagent prompt failed: ${prompted.result.error.message}`,
          isError: true,
        };
      }
      if (background) {
        return {
          content: [
            `Started background subagent \`${childId}\` (${label}).`,
            "Use send_message to continue, interrupt_agent to stop, list_agents to inspect.",
            "Keep working; do not busy-poll.",
          ].join("\n"),
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
        return { content: `subagent failed: ${message}`, isError: true };
      }
      const text = lastAssistantText(
        readSessionEvents(options.runtime.store, childId),
      );
      if (!text) {
        return {
          content: `(subagent ${childId} finished with no assistant text)`,
        };
      }
      return { content: text };
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
