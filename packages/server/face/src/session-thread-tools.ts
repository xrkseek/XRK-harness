/**
 * Model-facing thread_* — workspace 主线 catalog + session 支线 (written via presence_set).
 * 主线 = discovery pin (collab board / thread_list). Messaging does not require it.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import {
  sessionToolContext,
  threadMessageDescription,
} from "./session-tool-copy.js";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { formatToolError } from "./face-error-text.js";
import { boundChildAnswer } from "./adapt/subagent-answer-bound.js";
import {
  clampPeerWaitMs,
  PEER_WAIT_DEFAULT_MS,
  PEER_WAIT_MIN_MS,
  waitForPeerAssistantReply,
} from "./peer-session-wait.js";
import {
  armPeerCollabAfterPrompt,
  breakMutualPeerSyncWait,
  clearPeerCollabAfterSyncReply,
  formatMutualPeerWaitAsyncNotice,
  promoteFailedSyncPeerWait,
} from "./peer-collab-handoff.js";
import {
  formatPeerCollabPrompt,
  peerThreadMessageProblem,
  sameDelegatedParent,
  teamPeerLinked,
} from "./session-thread-message.js";
import {
  publishSessionThread,
  publishSessionThreads,
  sessionIdsOnThread,
} from "./session-thread-publish.js";
import {
  isAgentHomeSession,
  refuseCrossAgentHomeLane,
} from "./agent-home-boundary.js";
import { readWorkspaceDiscoverySettings } from "./workspace-discovery.js";

export interface BindSessionThreadToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
  /**
   * Legacy: only `thread_message` (sibling / peer-edge collab). Prefer
   * {@link ownLane} so children can still mint their own 主线.
   */
  readonly messageOnly?: boolean;
  /**
   * Delegated children: `thread_message` + self-only 主线 tools
   * (`thread_list` / `thread_upsert` / `thread_switch` / `thread_delete`).
   * Cannot pin peer `session_id`s.
   */
  readonly ownLane?: boolean;
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
      // Include delegated children — they mint their own 主线 for discovery.
      const sideline = sidelineOf(runtime, workspaceId, row.sessionId);
      const child = Boolean(runtime.subagents.getByChild(row.sessionId));
      return [
        {
          sessionId: row.sessionId,
          self: row.sessionId === selfId,
          ...(child ? { child: true as const } : {}),
          ...(sideline ? { sideline } : {}),
        },
      ];
    }),
  }));
}

/** Register thread_* (or only `thread_message` when `messageOnly`). */
export function bindSessionThreadTools(
  tools: ToolRegistry,
  options: BindSessionThreadToolsOptions,
): void {
  const {
    runtime,
    sessionId,
    messageOnly = false,
    ownLane = false,
  } = options;
  const ws = () => canvasWorkspaceIdForSession(runtime, sessionId);
  const childLane = ownLane || messageOnly;

  const registerThreadMessage = (): void => {
  registerTool(tools, {
    name: "thread_message",
    description:
      "Message another session by session_id. wait=true (default) returns the next assistant reply.",
    dynamicSchema: () => {
      // Keep description free of live sibling id lists — those change every
      // spawn and bust provider KV prefix reuse (DSH: tools[] must stay byte-stable).
      const { kind, surface } = sessionToolContext(runtime, sessionId);
      return {
        description: threadMessageDescription({
          kind,
          messageOnly: childLane,
          fromAgentHome: isAgentHomeSession(runtime, sessionId),
          ...(surface !== undefined ? { surface } : {}),
        }),
      };
    },
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: childLane
            ? "Sibling or peer-edge session id (turn-start squad board, session_inspect, or parent spawn ids)."
            : "Target parent session id (thread_list, collab board, workspace_session_prompt, or session_search).",
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
      const selfLink = runtime.subagents.getByChild(sessionId);
      const targetLink = runtime.subagents.getByChild(targetId);
      const selfDelegated = Boolean(selfLink && selfLink.mode !== "fork");
      const targetDelegated = Boolean(targetLink && targetLink.mode !== "fork");
      const sameParent =
        selfDelegated &&
        targetDelegated &&
        sameDelegatedParent(
          selfLink?.parentSessionId,
          targetLink?.parentSessionId,
        );
      const peerLinked =
        (selfLink &&
          teamPeerLinked(
            runtime.agentTeams.view(selfLink.parentSessionId).edges,
            sessionId,
            targetId,
          )) ||
        teamPeerLinked(
          runtime.agentTeams.view(sessionId).edges,
          sessionId,
          targetId,
        );
      // Settings siblingScope=none: same-parent children cannot mail each other
      // even when auto-mesh added a label=sibling peer edge. Explicit peer
      // links between non-siblings still work.
      const discovery = readWorkspaceDiscoverySettings(runtime);
      const siblingOk =
        discovery.siblingScope === "same-delegator"
          ? Boolean(sameParent || peerLinked)
          : Boolean(peerLinked && !sameParent);
      // Surface the Settings knob before the generic "use send_message" path.
      if (
        childLane &&
        sameParent &&
        discovery.siblingScope === "none"
      ) {
        return {
          content:
            "thread_message: siblingScope=none — children cannot message each other (Settings → Workspace discovery)",
          isError: true,
        };
      }
      const problem = peerThreadMessageProblem({
        selfId: sessionId,
        targetId,
        targetExists: Boolean(targetId && runtime.store.has(targetId)),
        targetIsChild: targetDelegated && !siblingOk,
        siblingOk,
      });
      if (problem) return { content: problem, isError: true };
      const laneProblem = refuseCrossAgentHomeLane(runtime, sessionId, targetId);
      if (laneProblem) {
        return { content: `thread_message: ${laneProblem}`, isError: true };
      }
      if (childLane && !siblingOk) {
        return {
          content:
            "thread_message: delegated children may only message siblings under the same parent, or a team peer edge",
          isError: true,
        };
      }
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
      const wait = a.wait !== false;
      const prompted = await dispatchFaceMethod(
        runtime,
        "session.prompt",
        rpcId,
        {
          sessionId: targetId,
          mode: "steer",
          // Collaboration speech — mutual 委派方; never forge kind:user / 老板.
          seatChannel: "peer",
          fromSessionId: sessionId,
          content: [
            {
              type: "text",
              text: formatPeerCollabPrompt({
                fromSessionId: sessionId,
                ...(fromTitle ? { fromThreadTitle: fromTitle } : {}),
                message,
                awaitingReply: wait,
              }),
            },
          ],
        },
      );
      if (!prompted.result.ok) {
        return { content: formatToolError(prompted.result.error), isError: true };
      }
      // One channel with subagent courier×handoff: arm always; sync success clears.
      armPeerCollabAfterPrompt({
        runtime,
        peerSessionId: targetId,
        waiterSessionId: sessionId,
        seqAtSend,
        wait,
      });
      if (!wait) {
        return { content: `delivered to ${targetId} (steer)` };
      }
      // Peer already wait:true on us → blocking would deadlock both drains.
      if (
        breakMutualPeerSyncWait({
          runtime,
          peerSessionId: targetId,
          waiterSessionId: sessionId,
        })
      ) {
        return { content: formatMutualPeerWaitAsyncNotice(targetId) };
      }
      const timeoutMs = clampPeerWaitMs(a.timeout_ms);
      let waited: Awaited<ReturnType<typeof waitForPeerAssistantReply>>;
      try {
        waited = await waitForPeerAssistantReply(
          runtime,
          targetId,
          seqAtSend,
          timeoutMs,
          signal,
          {
            yieldSessionId: sessionId,
            shouldBreak: () =>
              breakMutualPeerSyncWait({
                runtime,
                peerSessionId: targetId,
                waiterSessionId: sessionId,
              }),
          },
        );
      } catch (err) {
        // Turn cancelled mid-wait (user 「？」 / Stop): keep the courier channel
        // as async so the peer reply still lands as [会话协作] handoff.
        if (err instanceof Error && err.name === "AbortError") {
          promoteFailedSyncPeerWait({
            runtime,
            peerSessionId: targetId,
            waiterSessionId: sessionId,
          });
        }
        throw err;
      }
      if ("mutualWait" in waited) {
        return { content: formatMutualPeerWaitAsyncNotice(targetId) };
      }
      if ("yielded" in waited) {
        // Soft-detach (停止等待 / steer): async courier keeps the peer reply.
        promoteFailedSyncPeerWait({
          runtime,
          peerSessionId: targetId,
          waiterSessionId: sessionId,
        });
        return {
          content:
            `thread_message: wait detached (peer ${targetId} kept running; ` +
            `reply arrives as [会话协作] handoff)`,
        };
      }
      if ("reply" in waited) {
        clearPeerCollabAfterSyncReply({
          runtime,
          peerSessionId: targetId,
          waiterSessionId: sessionId,
        });
        return {
          content: `reply from ${targetId}:\n${boundChildAnswer(
            sessionId,
            targetId,
            waited.reply,
          )}`,
        };
      }
      // Timeout / quiet peer — promote leftover sync arm (peer may still run).
      promoteFailedSyncPeerWait({
        runtime,
        peerSessionId: targetId,
        waiterSessionId: sessionId,
      });
      return { content: `thread_message: ${waited.error}`, isError: true };
    },
  });
  };

  registerThreadMessage();
  if (messageOnly && !ownLane) return;

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
    description: ownLane
      ? "Create or revise **your** 主线 pin (title + optional brief). Delegated children mint their own pin — do not copy the parent. " +
        "Done + unused → thread_delete. Progress detail → todo_write / presence_set, not a new 主线 per micro-step."
      : "Create or revise a 主线 pin (title + optional brief) so siblings can find the mission on the collab board / thread_list. " +
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
        ...(ownLane
          ? {}
          : {
              workspace_id: {
                type: "string",
                description:
                  "Workspace whose catalog to write (default: this session's, or owner of session_id).",
              },
              session_id: {
                type: "string",
                description:
                  "Parent session to bind (default: this session). Must live in workspace_id.",
              },
            }),
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
      const targetSession = ownLane
        ? sessionId
        : String(a.session_id ?? "").trim() || sessionId;
      if (
        ownLane &&
        String(a.session_id ?? "").trim() &&
        String(a.session_id).trim() !== sessionId
      ) {
        return {
          content:
            "thread_upsert: child own-lane cannot pin another session_id — mint your own 主线 only",
          isError: true,
        };
      }
      const requestedWs = ownLane ? "" : String(a.workspace_id ?? "").trim();
      if (!runtime.store.has(targetSession)) {
        return {
          content: `thread_upsert: unknown session_id ${targetSession}`,
          isError: true,
        };
      }
      // Child sessions may mint their own 主线 (siblings discover via
      // thread_list). Fork lineage still pins like a parent chat.
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
      if (ownLane && id) {
        const bound =
          runtime.sessionThreads.bindOf(workspaceId, sessionId)?.threadId;
        if (bound !== id) {
          return {
            content:
              "thread_upsert: child own-lane may only revise the 主线 you are bound to",
            isError: true,
          };
        }
        // thread_switch can land a child on a parent/sibling pin — still
        // refuse rewriting a shared mission (title/brief stay owner-owned).
        const coBinders = sessionIdsOnThread(runtime, workspaceId, id).filter(
          (sid) => sid !== sessionId,
        );
        if (coBinders.length > 0) {
          return {
            content:
              "thread_upsert: child own-lane cannot revise a 主线 shared with other sessions — mint or revise your own pin",
            isError: true,
          };
        }
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
    description: ownLane
      ? "Delete **your** 主线 when you are the sole session bound to it. " +
        "Cannot delete a pin still shared with the parent or siblings."
      : "Delete a workspace 主线 you created and drop every session bind to it. " +
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
      if (ownLane) {
        if (!affected.includes(sessionId)) {
          return {
            content:
              "thread_delete: own-lane may only delete a 主线 you are bound to",
            isError: true,
          };
        }
        if (affected.some((sid) => sid !== sessionId)) {
          return {
            content:
              "thread_delete: own-lane refuses — other sessions still bound to this 主线",
            isError: true,
          };
        }
      }
      const ok = runtime.sessionThreads.remove(workspaceId, id);
      if (!ok) {
        return { content: "thread_delete: unknown 主线 id", isError: true };
      }
      publishSessionThreads(runtime, workspaceId, affected);
      return { content: JSON.stringify({ workspaceId, deleted: true, id }) };
    },
  });

  // 支线 caption is written by `presence_set` (tips + emotion) — it already
  // mirrors tips into the same thread store. A second, tips-only entry point
  // existed as `sideline_set` and only gave the model a coin flip between two
  // names for one effect.
}
