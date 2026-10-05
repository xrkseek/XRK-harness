/**
 * Model-facing thread_* / sideline_set — workspace 主线 catalog + session 支线.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { lastAssistantBodyText } from "./adapt/subagent-notice.js";
import { isChildSessionActive } from "./external-agent-runtime.js";
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

const PEER_WAIT_DEFAULT_MS = 10 * 60 * 1000;
const PEER_WAIT_MIN_MS = 1_000;
const PEER_POLL_MS = 300;

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
      "List this workspace's 主线 catalog only (not other workspaces). " +
      "A 主线 is an AI-owned collaboration pin: what this parent session is for, so sibling " +
      "parent sessions in the same workspace can notice it, read it, or thread_message a session on it. " +
      "It is not the user's message text. Do not mint from a greeting, a one-shot question, or a steer. " +
      "When this session becomes a lasting mission, call thread_upsert yourself — do not wait to be asked. " +
      "Each row lists parent sessions already attached. Unbound sessions do not appear. " +
      "Message a sibling with thread_message session_id (their assistant reply comes back here). " +
      "Keep this session's 主线. Do not thread_switch just to talk — switch only when this chat should share that pin (sidebar name changes). " +
      "That is not a subagent. Use session_search / session_read only to recall history. " +
      "Host may inject with session.prompt. Use thread_upsert / thread_delete yourself — never copy the user verbatim.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    isConcurrencySafe: () => true,
    presentCall: () => ({
      card: "generic",
      title: "thread_list",
      kind: "search",
      rawInput: {},
    }),
    execute: async () => {
      const workspaceId = ws();
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
      "Create or revise a workspace 主线 (title + optional brief) that you choose as the collaboration pin. " +
      "When the work is a lasting mission, call this without waiting for the user to ask. " +
      "Do not paste or paraphrase the user's latest message as the title. " +
      "Skip greetings, one-shot Q&A, and mid-turn steers. " +
      "Write a durable mission label siblings can anchor on. Pass id to revise. Default switch=true attaches this session.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string", description: "Short AI-owned 主线 label (sidebar when bound)." },
        brief: { type: "string", description: "What siblings should know this 主线 is for." },
        switch: {
          type: "boolean",
          description: "If true (default), attach this session to the 主线.",
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
      const workspaceId = ws();
      const thread = runtime.sessionThreads.upsert(workspaceId, {
        title,
        brief,
        ...(id ? { id } : {}),
      });
      if (!thread) {
        return { content: "thread_upsert: title required", isError: true };
      }
      if (shouldSwitch) {
        runtime.sessionThreads.switchTo(workspaceId, sessionId, thread.id);
      }
      const affected = new Set(sessionIdsOnThread(runtime, workspaceId, thread.id));
      affected.add(sessionId);
      publishSessionThreads(runtime, workspaceId, [...affected]);
      return { content: JSON.stringify({ workspaceId, thread }) };
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
      "Talk to another parent session_id that already has its own 主线 (may be a different pin). " +
      "Do not thread_switch first — this call does not change either session's bind. " +
      "Not a subagent: the peer keeps its own chat. Face wakes that session as steer (next tool-step / turn boundary), not Settings busyEnter queue. wait=true (default) " +
      "returns its next assistant message here. Children use send_message / followup_task instead.",
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Target parent session id from thread_list / the collab board.",
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
      const workspaceId = ws();
      const problem = peerThreadMessageProblem({
        selfId: sessionId,
        targetId,
        selfBound: Boolean(runtime.sessionThreads.bindOf(workspaceId, sessionId)),
        targetBound: Boolean(runtime.sessionThreads.bindOf(workspaceId, targetId)),
        targetIsChild: Boolean(runtime.subagents.getByChild(targetId)),
      });
      if (problem) return { content: problem, isError: true };
      if (!message) {
        return { content: "thread_message requires message", isError: true };
      }
      const selfThread = runtime.sessionThreads.bindOf(workspaceId, sessionId);
      const fromTitle = selfThread
        ? runtime.sessionThreads.get(workspaceId, selfThread.threadId)?.title
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
      let timeoutMs = PEER_WAIT_DEFAULT_MS;
      if (typeof a.timeout_ms === "number" && Number.isFinite(a.timeout_ms)) {
        timeoutMs = Math.min(
          PEER_WAIT_DEFAULT_MS,
          Math.max(PEER_WAIT_MIN_MS, Math.floor(a.timeout_ms)),
        );
      }
      const deadline = Date.now() + timeoutMs;
      const stillRunning = () => isChildSessionActive(runtime, targetId);
      while (stillRunning() || Date.now() < deadline) {
        if (signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        if (!stillRunning()) {
          const events = readSessionEvents(runtime.store, targetId);
          if (events.length > seqAtSend) {
            const reply = lastAssistantBodyText(events.slice(seqAtSend)).trim();
            if (reply) {
              return {
                content: `reply from ${targetId}:\n${reply}`,
              };
            }
            if (Date.now() > deadline) break;
          }
        }
        if (Date.now() > deadline) break;
        const remaining = Math.max(0, deadline - Date.now());
        if (
          stillRunning() &&
          runtime.drain.run &&
          !runtime.externalAgents.has(targetId)
        ) {
          try {
            await Promise.race([
              runtime.drain.run(targetId),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("wait slice")),
                  Math.min(PEER_POLL_MS * 20, remaining),
                ),
              ),
            ]);
          } catch {
            /* keep polling */
          }
        } else {
          await new Promise((r) =>
            setTimeout(r, Math.min(PEER_POLL_MS, remaining)),
          );
        }
      }
      const events = readSessionEvents(runtime.store, targetId);
      const reply = lastAssistantBodyText(events.slice(seqAtSend)).trim();
      if (reply) {
        return { content: `reply from ${targetId}:\n${reply}` };
      }
      return {
        content: stillRunning()
          ? `thread_message: ${targetId} still running after ${timeoutMs}ms`
          : `thread_message: ${targetId} idle with no assistant reply`,
        isError: true,
      };
    },
  });

  registerTool(tools, {
    name: "sideline_set",
    description:
      "Write this session's 支线 caption (same as presence_set tips). " +
      "Shows under the session name and on the Overview ball so the user sees what you are doing now. " +
      "Does not change the session name. Does not require a 主线. Prefer presence_set when also changing emotion.",
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
