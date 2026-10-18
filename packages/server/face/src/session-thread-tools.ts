/**
 * Model-facing thread_* / sideline_set — workspace 主线 catalog + session 支线.
 * 主线 = discovery pin (collab board / thread_list). Messaging does not require it.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { boundChildAnswer } from "./adapt/subagent-answer-bound.js";
import {
  clampPeerWaitMs,
  PEER_WAIT_DEFAULT_MS,
  PEER_WAIT_MIN_MS,
  waitForPeerAssistantReply,
} from "./peer-session-wait.js";
import {
  formatPeerCollabPrompt,
  peerThreadMessageProblem,
} from "./session-thread-message.js";
import {
  publishSessionThread,
  publishSessionThreads,
  sessionIdsOnThread,
} from "./session-thread-publish.js";
import { SIDELINE_MAX } from "./session-thread-store.js";

export interface BindSessionThreadToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
}

function registerTool(tools: ToolRegistry, tool: ToolDefinition): void {
  if (tools.get(tool.name)) return;
  tools.register(tool);
}

function readArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

function sidelineOf(
  runtime: FaceRuntime,
  workspaceId: string,
  targetId: string,
): string | undefined {
  const bind = runtime.sessionThreads.bindOf(workspaceId, targetId);
  const text = bind?.sideline ?? runtime.presence.get(targetId)?.tips;
  return text ? text : undefined;
}

/**
 * Catalog rows for this workspace only: 主线 entries plus parent sessions
 * already attached. Unbound sessions (first-message sidebar titles) stay out.
 */
export function listWorkspaceThreadCatalog(
  runtime: FaceRuntime,
  workspaceId: string,
  selfId: string,
): ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly updatedAt: number;
  readonly sessions: ReadonlyArray<{
    readonly sessionId: string;
    readonly self: boolean;
    readonly sideline?: string;
  }>;
}> {
  const binds = runtime.sessionThreads.listBinds(workspaceId);
  return runtime.sessionThreads.list(workspaceId).map((thread) => ({
    id: thread.id,
    title: thread.title,
    brief: thread.brief,
    updatedAt: thread.updatedAt,
    sessions: binds.flatMap((row) => {
      if (row.threadId !== thread.id) return [];
      if (runtime.subagents.getByChild(row.sessionId)) return [];
      const sideline = sidelineOf(runtime, workspaceId, row.sessionId);
      return [
        {
          sessionId: row.sessionId,
          self: row.sessionId === selfId,
          ...(sideline ? { sideline } : {}),
        },
      ];
    }),
  }));
}

/** Register thread_list / thread_upsert / thread_switch / thread_delete / sideline_set. */
export function bindSessionThreadTools(
  tools: ToolRegistry,
  options: BindSessionThreadToolsOptions,
): void {
  const { runtime, sessionId } = options;
  const ws = () => canvasWorkspaceIdForSession(runtime, sessionId);

  registerTool(tools, {
    name: "thread_list",
    description:
      "List a workspace 主线 catalog (discovery pin of lasting missions + attached parent session ids). " +
      "Default: this session's workspace. Pass workspace_id to inspect another workspace (e.g. after workspace_session_prompt). " +
      "主线 is not a gate for messaging — any parent can thread_message any parent by session_id. " +
      "Unbound sessions stay off this list; find them with session_search. " +
      "Do not mint a 主线 from a greeting or one-shot Q&A.",
    parameters: {
      type: "object",
      properties: {
        workspace_id: {
          type: "string",
          description: "Optional Face workspace id (default: this session's workspace).",
        },
      },
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "thread_list",
      kind: "search",
      rawInput: args ?? {},
    }),
    execute: async (args) => {
      const a = readArgs(args);
      const requested = String(a.workspace_id ?? "").trim();
      const workspaceId = requested || ws();
      if (requested && !runtime.workspaces.get(workspaceId)) {
        return {
          content: `thread_list: unknown workspace_id ${workspaceId}`,
          isError: true,
        };
      }
      return {
        content: JSON.stringify({
          workspaceId,
          threads: listWorkspaceThreadCatalog(runtime, workspaceId, sessionId),
          bind: runtime.sessionThreads.bindOf(workspaceId, sessionId) ?? null,
        }),
      };
    },
  });

  registerTool(tools, {
    name: "thread_upsert",
    description:
      "Create or revise a 主线 pin (title + optional brief) so siblings can find the mission on the collab board / thread_list. " +
      "Default attaches this session in this workspace. " +
      "Orchestrators (向阳 / IM / coding): pass session_id (+ workspace_id) to pin a peer session you opened elsewhere — " +
      "e.g. after workspace_session_prompt returns a coding session_id. " +
      "Not required before thread_message. Skip greetings / one-shot Q&A. Pass id to revise.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string", description: "Short AI-owned 主线 label (sidebar when bound)." },
        brief: { type: "string", description: "What siblings should know this 主线 is for." },
        switch: {
          type: "boolean",
          description:
            "If true (default), attach the target session (this session, or session_id when set).",
        },
        workspace_id: {
          type: "string",
          description: "Workspace whose catalog to write (default: this session's, or owner of session_id).",
        },
        session_id: {
          type: "string",
          description: "Parent session to bind (default: this session). Must live in workspace_id.",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "thread_upsert",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const a = readArgs(args);
      const title = String(a.title ?? "");
      const brief = typeof a.brief === "string" ? a.brief : "";
      const id = typeof a.id === "string" ? a.id : undefined;
      const shouldSwitch = a.switch !== false;
      const targetSession = String(a.session_id ?? "").trim() || sessionId;
      const requestedWs = String(a.workspace_id ?? "").trim();
      if (!runtime.store.has(targetSession)) {
        return {
          content: `thread_upsert: unknown session_id ${targetSession}`,
          isError: true,
        };
      }
      const childLink = runtime.subagents.getByChild(targetSession);
      if (childLink && childLink.mode !== "fork") {
        return {
          content: "thread_upsert: cannot pin a subagent — pin the parent",
          isError: true,
        };
      }
      const ownerWs = runtime.workspaces.workspaceIdOf(targetSession);
      const workspaceId = requestedWs || ownerWs || ws();
      if (requestedWs && !runtime.workspaces.get(requestedWs)) {
        return {
          content: `thread_upsert: unknown workspace_id ${requestedWs}`,
          isError: true,
        };
      }
      if (ownerWs && ownerWs !== workspaceId) {
        return {
          content: `thread_upsert: session ${targetSession} is in ${ownerWs}, not ${workspaceId}`,
          isError: true,
        };
      }
      const thread = runtime.sessionThreads.upsert(workspaceId, {
        title,
        brief,
        ...(id ? { id } : {}),
      });
      if (!thread) {
        return { content: "thread_upsert: title required", isError: true };
      }
      if (shouldSwitch) {
        runtime.sessionThreads.switchTo(workspaceId, targetSession, thread.id);
      }
      const affected = new Set(
        sessionIdsOnThread(runtime, workspaceId, thread.id),
      );
      affected.add(targetSession);
      publishSessionThreads(runtime, workspaceId, [...affected]);
      return {
        content: JSON.stringify({
          workspaceId,
          thread,
          sessionId: targetSession,
        }),
      };
    },
  });

  registerTool(tools, {
    name: "thread_switch",
    description:
      "Rebind this parent session onto an existing workspace 主线. The sidebar title becomes that pin. " +
      "Use after thread_list when this chat should share a peer's pin instead of minting a duplicate. " +
      "Not a step before thread_message — mailing a sibling does not move this session.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "thread_switch",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const id = String(readArgs(args).id ?? "").trim();
      const workspaceId = ws();
      const previousThreadId =
        runtime.sessionThreads.bindOf(workspaceId, sessionId)?.threadId;
      const bind = runtime.sessionThreads.switchTo(workspaceId, sessionId, id);
      if (!bind) {
        return { content: "thread_switch: unknown 主线 id", isError: true };
      }
      publishSessionThread(runtime, workspaceId, sessionId);
      return {
        content: JSON.stringify({
          workspaceId,
          bind,
          ...(previousThreadId && previousThreadId !== bind.threadId
            ? { previousThreadId }
            : {}),
        }),
      };
    },
  });

  registerTool(tools, {
    name: "thread_delete",
    description:
      "Delete a workspace 主线 you created and drop every session bind to it. " +
      "Does not delete sessions. Only this workspace's catalog.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "thread_delete",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const id = String(readArgs(args).id ?? "").trim();
      const workspaceId = ws();
      const affected = sessionIdsOnThread(runtime, workspaceId, id);
      const ok = runtime.sessionThreads.remove(workspaceId, id);
      if (!ok) {
        return { content: "thread_delete: unknown 主线 id", isError: true };
      }
      publishSessionThreads(runtime, workspaceId, affected);
      return { content: JSON.stringify({ workspaceId, deleted: true, id }) };
    },
  });

  registerTool(tools, {
    name: "thread_message",
    description:
      "Message another parent session by session_id (same or other workspace). " +
      "主线 is optional — use it to discover peers quickly; messaging does not require either side to be pinned. " +
      "Do not thread_switch first — this does not change either bind. " +
      "Not a subagent: peer keeps its own chat. Delivery is steer (not Settings busyEnter queue). " +
      "wait=true (default) returns the peer's next assistant message. Children use send_message / followup_task.",
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description:
            "Target parent session id (thread_list, collab board, workspace_session_prompt, or session_search).",
        },
        message: { type: "string", description: "What the peer should do or answer." },
        wait: {
          type: "boolean",
          description: "If true (default), wait for the peer's assistant reply.",
        },
        timeout_ms: {
          type: "number",
          description: `Wait budget in ms (default ${PEER_WAIT_DEFAULT_MS}; min ${PEER_WAIT_MIN_MS}).`,
        },
      },
      required: ["session_id", "message"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "thread_message",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args, signal) => {
      const a = readArgs(args);
      const targetId = String(a.session_id ?? "").trim();
      const message = String(a.message ?? "").trim();
      const childLink = runtime.subagents.getByChild(targetId);
      const problem = peerThreadMessageProblem({
        selfId: sessionId,
        targetId,
        targetExists: Boolean(targetId && runtime.store.has(targetId)),
        targetIsChild: Boolean(childLink && childLink.mode !== "fork"),
      });
      if (problem) return { content: problem, isError: true };
      if (!message) {
        return { content: "thread_message requires message", isError: true };
      }
      const selfWs = ws();
      const selfThread = runtime.sessionThreads.bindOf(selfWs, sessionId);
      const fromTitle = selfThread
        ? runtime.sessionThreads.get(selfWs, selfThread.threadId)?.title
        : undefined;
      const rpcId = `tool-th-msg-${sessionId}-${targetId}`;
      const seqAtSend = readSessionEvents(runtime.store, targetId).length;
      const prompted = await dispatchFaceMethod(
        runtime,
        "session.prompt",
        rpcId,
        {
          sessionId: targetId,
          mode: "steer",
          content: [
            {
              type: "text",
              text: formatPeerCollabPrompt({
                fromSessionId: sessionId,
                ...(fromTitle ? { fromThreadTitle: fromTitle } : {}),
                message,
              }),
            },
          ],
        },
      );
      if (!prompted.result.ok) {
        return { content: prompted.result.error.message, isError: true };
      }
      const wait = a.wait !== false;
      if (!wait) {
        return { content: `delivered to ${targetId} (steer)` };
      }
      const timeoutMs = clampPeerWaitMs(a.timeout_ms);
      const waited = await waitForPeerAssistantReply(
        runtime,
        targetId,
        seqAtSend,
        timeoutMs,
        signal,
      );
      if ("reply" in waited) {
        return {
          content: `reply from ${targetId}:\n${boundChildAnswer(
            sessionId,
            targetId,
            waited.reply,
          )}`,
        };
      }
      return { content: `thread_message: ${waited.error}`, isError: true };
    },
  });

  registerTool(tools, {
    name: "sideline_set",
    description:
      "Write this session's 支线 caption (same as presence_set tips). " +
      "Shows under the session name in the sidebar (primary). Overview ball may mirror mood when that chrome is on. " +
      "Does not change the session name / 主线. Prefer presence_set when also changing emotion.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: `Current work caption (≤${SIDELINE_MAX} chars).` },
      },
      required: ["text"],
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "sideline_set",
      kind: "other",
      rawInput: args,
    }),
    execute: async (args) => {
      const text = String(readArgs(args).text ?? "");
      const workspaceId = ws();
      const clipped = text.trim().slice(0, SIDELINE_MAX);
      const bind = runtime.sessionThreads.bindOf(workspaceId, sessionId);
      const next = bind
        ? runtime.sessionThreads.setSideline(workspaceId, sessionId, clipped)
        : bind;
      const sticky = runtime.presence.get(sessionId);
      runtime.presence.set(sessionId, {
        emotionId: sticky?.emotionId ?? "30",
        tips: clipped,
      });
      publishSessionThread(runtime, workspaceId, sessionId);
      return { content: JSON.stringify({ workspaceId, bind: next ?? null, tips: clipped }) };
    },
  });
}
