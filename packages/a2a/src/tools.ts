/**
 * Model-facing A2A tools (Hermes `a2a` toolset subset).
 */

import type { ToolDefinition } from "@xrkseek/core-tools";
import { createA2aClient, type A2aClient, type A2aClientOptions } from "./client.js";
import { ROLE_AGENT, ROLE_USER } from "./protocol.js";

export interface CreateA2aToolsOptions extends A2aClientOptions {
  readonly client?: A2aClient;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function createA2aTools(
  options: CreateA2aToolsOptions = {},
): ToolDefinition[] {
  const client = options.client ?? createA2aClient(options);

  const discover: ToolDefinition = {
    name: "a2a_discover",
    description:
      "Fetch and summarize an A2A peer Agent Card (skills, auth, protocol URL).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Peer base URL (e.g. http://host:9900)." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    async execute(args) {
      const url = str((args as { url?: unknown }).url);
      return { content: await client.discover(url) };
    },
  };

  const call: ToolDefinition = {
    name: "a2a_call",
    description:
      "Send a task to an A2A peer (configured name or http(s) URL). Pass context_id from a prior reply to continue multi-turn. Anti-loop caps turns per context.",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Configured peer name or full http(s) URL.",
        },
        message: { type: "string", description: "Task text for the peer." },
        context_id: {
          type: "string",
          description: "Optional context id from a prior reply.",
        },
      },
      required: ["agent", "message"],
      additionalProperties: false,
    },
    async execute(args) {
      const a = args as {
        agent?: unknown;
        agent_name?: unknown;
        name?: unknown;
        message?: unknown;
        text?: unknown;
        task?: unknown;
        context_id?: unknown;
        contextId?: unknown;
      };
      const agent = str(a.agent || a.agent_name || a.name);
      const message = str(a.message || a.text || a.task);
      const contextId = str(a.context_id || a.contextId);
      if (!agent || !message) {
        return {
          content: "Error: both 'agent' and 'message' are required.",
          isError: true,
        };
      }
      const result = await client.call(agent, message, contextId);
      return { content: result.content, ...(result.ok ? {} : { isError: true }) };
    },
  };

  const list: ToolDefinition = {
    name: "a2a_list",
    description:
      "List configured A2A peers and persisted conversation context ids (for a2a_history).",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const peers = client.listPeers();
      const lines: string[] = ["Configured peers:"];
      const names = Object.keys(peers);
      if (names.length === 0) {
        lines.push("  (none — set XRK_A2A_AGENTS or ~/.xrk/a2a_agents.json)");
      } else {
        for (const name of names.sort()) {
          const p = peers[name]!;
          const caps = p.capabilities?.length
            ? ` caps=[${p.capabilities.join(",")}]`
            : "";
          lines.push(`  - ${name}: ${p.url}${caps}`);
        }
      }
      const convos = client.listConversations();
      lines.push(`Persisted conversations (${convos.length}) — recall with a2a_history:`);
      for (const id of convos.slice(0, 40)) {
        lines.push(`  - ${id}`);
      }
      return { content: lines.join("\n") };
    },
  };

  const history: ToolDefinition = {
    name: "a2a_history",
    description:
      "Recall a persisted A2A conversation transcript by context_id (survives restarts and session compaction).",
    parameters: {
      type: "object",
      properties: {
        context_id: {
          type: "string",
          description: "Context id of the conversation to recall.",
        },
        limit: {
          type: "number",
          description: "Max messages to return (default 50).",
        },
      },
      required: ["context_id"],
      additionalProperties: false,
    },
    async execute(args) {
      const a = args as { context_id?: unknown; contextId?: unknown; limit?: unknown };
      const contextId = str(a.context_id || a.contextId);
      if (!contextId) {
        return {
          content:
            "Error: 'context_id' is required (see a2a_list for known conversations).",
          isError: true,
        };
      }
      const limit =
        typeof a.limit === "number" && Number.isFinite(a.limit)
          ? Math.max(1, Math.trunc(a.limit))
          : 50;
      const messages = client.history(contextId, limit);
      if (messages.length === 0) {
        return {
          content: `No persisted conversation for context '${contextId}'.`,
        };
      }
      const lines = [
        `Conversation ${contextId} (last ${messages.length} messages):`,
      ];
      for (const m of messages) {
        const role =
          m.role === ROLE_AGENT || m.role === "agent"
            ? "agent"
            : m.role === ROLE_USER || m.role === "user"
              ? "user"
              : m.role;
        lines.push(`[${role}] ${m.text}`);
      }
      return { content: lines.join("\n") };
    },
  };

  return [discover, call, list, history];
}
