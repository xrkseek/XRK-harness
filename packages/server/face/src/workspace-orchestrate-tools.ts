/**
 * Cross-workspace orchestration tools — IM (`ws_im`), 奇创 (向阳空间), and coding.
 *
 * | Tool | IM | 奇创 | coding |
 * |---|---|---|---|
 * | workspace_list / workspace_create | yes | yes | yes |
 * | workspace_session_prompt (peer + wait reply) | yes | yes | yes |
 * | subagent + workspace_id | Host binds for IM only | never | never (local nested only) |
 *
 * Ongoing tasking to a known session_id: prefer `thread_message` (works without 主线).
 * Pin a peer for discovery: `thread_upsert` with session_id + workspace_id.
 */

import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { boundChildAnswer } from "./adapt/subagent-answer-bound.js";
import {
  clampPeerWaitMs,
  PEER_WAIT_DEFAULT_MS,
  PEER_WAIT_MIN_MS,
  waitForPeerAssistantReply,
} from "./peer-session-wait.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";
import { dispatchFaceMethod } from "./dispatch.js";

function registerTool(tools: ToolRegistry, tool: ToolDefinition): void {
  if (tools.get(tool.name)) return;
  tools.register(tool);
}

export type WorkspaceOrchestrateMode = "im" | "qichuang" | "coding";

export interface BindWorkspaceOrchestrateToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
  readonly mode: WorkspaceOrchestrateMode;
}

function listItems(runtime: FaceRuntime) {
  const listed = runtime.workspaces.list(runtime.store.list());
  return listed.items.map((row) => ({
    workspaceId: row.workspaceId,
    title: row.title,
    path: row.path,
    sessionCount: row.sessionIds.length,
    im: row.workspaceId === IM_WORKSPACE_ID,
    xiangyang: row.workspaceId === XIANGYANG_WORKSPACE_ID,
  }));
}

function fromLabel(mode: WorkspaceOrchestrateMode): string {
  if (mode === "im") return "IM";
  if (mode === "qichuang") return "Xiangyang";
  return "coding";
}

/**
 * Bind list / create / peer-session dispatch.
 * Does not bind `subagent` — Host does that for IM only.
 */
export function bindWorkspaceOrchestrateTools(
  tools: ToolRegistry,
  options: BindWorkspaceOrchestrateToolsOptions,
): void {
  const { runtime, sessionId, mode } = options;
  const label = fromLabel(mode);
  const dispatchHint =
    mode === "im"
      ? "Prefer `subagent` + workspace_id for a coding child; use `workspace_session_prompt` for a peer session without parent/child linkage, then `thread_message` with the returned session_id."
      : mode === "qichuang"
        ? "Qichuang has no nested subagents — open peers with `workspace_session_prompt`, keep the session_id, then `thread_message` / optional `thread_upsert` to pin them."
        : "Open or prompt a peer coding workspace with `workspace_session_prompt`; continue with `thread_message` by session_id (主线 optional).";

  registerTool(tools, {
    name: "workspace_list",
    description:
      "List Face workspaces (id, title, path, session count). " +
      dispatchHint,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({
      card: "generic",
      title: "workspace_list",
      kind: "search",
      rawInput: {},
    }),
    async execute() {
      return { content: JSON.stringify({ items: listItems(runtime) }) };
    },
  });

  registerTool(tools, {
    name: "workspace_create",
    description:
      "Create (or adopt) a coding Face workspace by absolute path. " +
      "Returns workspaceId for later session dispatch. " +
      "Refuse paths that would become Xiangyang or IM.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Fully qualified absolute directory" },
        title: { type: "string", description: "Optional display title" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    isConcurrencySafe: () => false,
    presentCall: (args) => ({
      card: "generic",
      title: "workspace_create",
      kind: "other",
      rawInput: args ?? {},
    }),
    async execute(args) {
      const a = (args ?? {}) as Record<string, unknown>;
      const rawPath = String(a.path ?? "").trim();
      const title = String(a.title ?? "").trim();
      if (!rawPath) {
        return { content: "workspace_create: path required", isError: true };
      }
      const created = await dispatchFaceMethod(
        runtime,
        "workspace.create",
        `orch-wc-${Date.now().toString(36)}`,
        { path: rawPath },
      );
      if (!created.result.ok) {
        return {
          content: `workspace_create: ${created.result.error.message}`,
          isError: true,
        };
      }
      const value = created.result.value as {
        workspace: { workspaceId: string; path: string; title: string };
        created: boolean;
      };
      const id = value.workspace.workspaceId;
      if (id === XIANGYANG_WORKSPACE_ID || id === IM_WORKSPACE_ID) {
        return {
          content: "workspace_create: refused reserved workspace id",
          isError: true,
        };
      }
      if (title) {
        await dispatchFaceMethod(
          runtime,
          "workspace.rename",
          `orch-wr-${Date.now().toString(36)}`,
          { workspaceId: id, title },
        );
      }
      const row = runtime.workspaces.get(id);
      return {
        content: JSON.stringify({
          workspaceId: id,
          path: row?.path ?? value.workspace.path,
          title: row?.title ?? value.workspace.title,
          created: value.created,
        }),
      };
    },
  });

  registerTool(tools, {
    name: "workspace_session_prompt",
    description:
      "Create (or reuse) a session in a coding Face workspace and send a prompt. " +
      `Dispatch from ${label} — peer session, not a nested subagent. ` +
      "Returns sessionId — keep it for follow-up `thread_message` / `thread_upsert`. " +
      "wait=true (default) steers and returns the peer assistant reply; wait=false queues without waiting.",
    parameters: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        prompt: { type: "string" },
        session_id: { type: "string" },
        label: { type: "string" },
        wait: {
          type: "boolean",
          description: "If true (default), wait for the peer's assistant reply.",
        },
        timeout_ms: {
          type: "number",
          description: `Wait budget in ms (default ${PEER_WAIT_DEFAULT_MS}; min ${PEER_WAIT_MIN_MS}).`,
        },
      },
      required: ["workspace_id", "prompt"],
      additionalProperties: false,
    },
    isConcurrencySafe: () => false,
    presentCall: (args) => ({
      card: "generic",
      title: "workspace_session_prompt",
      kind: "other",
      rawInput: args ?? {},
    }),
    async execute(args, signal) {
      const a = (args ?? {}) as Record<string, unknown>;
      const workspaceId = String(a.workspace_id ?? "").trim();
      const prompt = String(a.prompt ?? "").trim();
      const sessionIdArg = String(a.session_id ?? "").trim();
      const sessionLabel = String(a.label ?? "").trim();
      const wait = a.wait !== false;
      if (!workspaceId || !prompt) {
        return {
          content: "workspace_session_prompt: workspace_id and prompt required",
          isError: true,
        };
      }
      if (workspaceId === XIANGYANG_WORKSPACE_ID) {
        return {
          content:
            "workspace_session_prompt: refuse Xiangyang — pick a coding workspace",
          isError: true,
        };
      }
      if (workspaceId === IM_WORKSPACE_ID) {
        return {
          content:
            "workspace_session_prompt: refuse IM workspace — pick a coding workspace",
          isError: true,
        };
      }
      if (!runtime.workspaces.get(workspaceId)) {
        return {
          content: `workspace_session_prompt: unknown workspace_id ${workspaceId}`,
          isError: true,
        };
      }

      let targetId = sessionIdArg;
      if (targetId && runtime.store.has(targetId)) {
        const owner = runtime.workspaces.workspaceIdOf(targetId);
        if (owner !== workspaceId) {
          return {
            content: `workspace_session_prompt: session ${targetId} is not in ${workspaceId}`,
            isError: true,
          };
        }
      } else {
        const created = await dispatchFaceMethod(
          runtime,
          "session.create",
          `orch-sc-${Date.now().toString(36)}`,
          {
            ...(targetId ? { sessionId: targetId } : {}),
            workspaceId,
            ...(sessionLabel ? { label: sessionLabel } : {}),
            agentPreset: "harness",
          },
        );
        if (!created.result.ok) {
          return {
            content: `workspace_session_prompt: create failed — ${created.result.error.message}`,
            isError: true,
          };
        }
        const value = created.result.value as { sessionId?: string };
        targetId =
          typeof value.sessionId === "string" && value.sessionId.trim()
            ? value.sessionId.trim()
            : targetId;
        if (!targetId || !runtime.store.has(targetId)) {
          return {
            content: "workspace_session_prompt: create returned no sessionId",
            isError: true,
          };
        }
      }

      const seqAtSend = readSessionEvents(runtime.store, targetId).length;
      const prompted = await dispatchFaceMethod(
        runtime,
        "session.prompt",
        `orch-sp-${Date.now().toString(36)}`,
        {
          sessionId: targetId,
          mode: wait ? "steer" : "queue",
          content: [
            {
              type: "text",
              text: `[from ${label} session ${sessionId}]\n\n${prompt}`,
            },
          ],
        },
      );
      if (!prompted.result.ok) {
        return {
          content: `workspace_session_prompt: prompt failed — ${prompted.result.error.message}`,
          isError: true,
        };
      }
      if (!wait) {
        return {
          content: JSON.stringify({
            workspaceId,
            sessionId: targetId,
            ok: true,
            wait: false,
          }),
        };
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
          content: JSON.stringify({
            workspaceId,
            sessionId: targetId,
            ok: true,
            wait: true,
            reply: boundChildAnswer(sessionId, targetId, waited.reply),
          }),
        };
      }
      return {
        content: `workspace_session_prompt: ${waited.error}`,
        isError: true,
      };
    },
  });
}
