/**
 * Face remotes `threads/*` and `team/*`: workspace 主线, plus Agent Team as the
 * child's tools / inject / playbook roster.
 */
import { readSessionEvents } from "@xrkseek/core-session";
import { canvasWorkspaceIdForSession } from "../canvas-tools.js";
import {
  applySubagentSpawnPreamble,
  isAgentTeamSpawnRole,
  rootUserAuthorizationBlock,
} from "../agent-team-roles.js";
import {
  memberIdProblem,
  catalogMemberWriteProblem,
  parseMemberAppearance,
  parseMemberToolPolicy,
  parseRosterScope,
} from "../agent-roster-store.js";
import { captureSessionPlaybook } from "../capture-member-playbook.js";
import { resolveSessionCwd } from "../session-cwd.js";
import {
  publishSessionThread,
  publishSessionThreads,
  sessionIdsOnThread,
} from "../session-thread-publish.js";
import { asRecord, remoteArgs, type FaceHandler } from "./types.js";
import { sessionCreate, sessionPrompt } from "./session.js";

function sessionIdOf(payload: unknown): string {
  const args = remoteArgs(payload);
  const flat = asRecord(payload);
  return String(
    args.sessionId ?? flat.sessionId ?? args.agentId ?? flat.agentId ?? "",
  ).trim();
}

function requireSession(runtime: Parameters<FaceHandler>[0], sessionId: string) {
  if (!sessionId) {
    return {
      ok: false as const,
      error: { code: "invalid-payload" as const, message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false as const,
      error: { code: "session-not-found" as const, message: sessionId },
    };
  }
  return undefined;
}

export const threadsList: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  return {
    ok: true,
    value: {
      workspaceId,
      threads: runtime.sessionThreads.list(workspaceId),
      bind: runtime.sessionThreads.bindOf(workspaceId, sessionId) ?? null,
    },
  };
};

export const threadsUpsert: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const title = String(args.title ?? "").trim();
  const brief = typeof args.brief === "string" ? args.brief : "";
  const id = typeof args.id === "string" ? args.id : undefined;
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const thread = runtime.sessionThreads.upsert(workspaceId, {
    title,
    brief,
    ...(id ? { id } : {}),
  });
  if (!thread) {
    return { ok: false, error: { code: "invalid-payload", message: "title required" } };
  }
  if (args.switch !== false) {
    runtime.sessionThreads.switchTo(workspaceId, sessionId, thread.id);
  }
  const affected = new Set(sessionIdsOnThread(runtime, workspaceId, thread.id));
  affected.add(sessionId);
  publishSessionThreads(runtime, workspaceId, [...affected]);
  return { ok: true, value: { workspaceId, thread } };
};

export const threadsSwitch: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const id = String(remoteArgs(payload).id ?? "").trim();
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const bind = runtime.sessionThreads.switchTo(workspaceId, sessionId, id);
  if (!bind) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown thread id" } };
  }
  publishSessionThread(runtime, workspaceId, sessionId);
  return { ok: true, value: { workspaceId, bind } };
};

export const threadsRemove: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const id = String(remoteArgs(payload).id ?? "").trim();
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const affected = sessionIdsOnThread(runtime, workspaceId, id);
  const ok = runtime.sessionThreads.remove(workspaceId, id);
  if (!ok) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown thread id" } };
  }
  publishSessionThreads(runtime, workspaceId, affected);
  return { ok: true, value: { workspaceId, deleted: true, id } };
};

export const teamList: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  return {
    ok: true,
    value: {
      workspaceId,
      members: runtime.agentRoster.listVisible(workspaceId),
    },
  };
};

export const teamUpsert: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const idProblem = memberIdProblem(args.id);
  if (idProblem) {
    return { ok: false, error: { code: "invalid-payload", message: idProblem } };
  }
  const catalogProblem = catalogMemberWriteProblem(args.id);
  if (catalogProblem) {
    return { ok: false, error: { code: "invalid-payload", message: catalogProblem } };
  }
  const roleRaw = typeof args.role === "string" ? args.role : "worker";
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const scope = parseRosterScope(args.scope);
  const appearanceArg =
    args.appearance && typeof args.appearance === "object"
      ? args.appearance
      : {
          ...(typeof args.shape === "string" ? { shape: args.shape } : {}),
          ...(typeof args.color === "string" ? { color: args.color } : {}),
          ...(typeof args.kit === "string" ? { kit: args.kit } : {}),
          ...(typeof args.face === "string" ? { face: args.face } : {}),
        };
  const hasAppearance =
    appearanceArg &&
    typeof appearanceArg === "object" &&
    Object.keys(appearanceArg).length > 0;
  const toolsRaw =
    args.tools && typeof args.tools === "object" ? args.tools : undefined;
  const tools = parseMemberToolPolicy(toolsRaw);
  const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
    name: String(args.name ?? ""),
    playbook: String(args.playbook ?? ""),
    role: isAgentTeamSpawnRole(roleRaw) ? roleRaw : "worker",
    ...(typeof args.brief === "string" ? { brief: args.brief } : {}),
    ...(args.inject === "subagent" || args.inject === "minimal"
      ? { inject: args.inject }
      : {}),
    ...(tools
      ? { tools }
      : args.tools === null
        ? { tools: null }
        : {}),
    ...(hasAppearance
      ? {
          appearance: parseMemberAppearance(appearanceArg, {
            shape: "blob",
            color: "cream",
          }),
        }
      : {}),
    ...(typeof args.id === "string" ? { id: args.id } : {}),
  });
  if (!member) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "name and playbook required" },
    };
  }
  return { ok: true, value: { workspaceId: scope === "global" ? "global" : canvasId, member } };
};

export const teamRemove: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const id = String(args.id ?? "").trim();
  const catalogProblem = catalogMemberWriteProblem(id);
  if (catalogProblem) {
    return { ok: false, error: { code: "invalid-payload", message: catalogProblem } };
  }
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const scope = parseRosterScope(args.scope);
  const workspaceId = scope === "global" ? "global" : canvasId;
  const ok = runtime.agentRoster.remove(workspaceId, id);
  if (!ok) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown member id" } };
  }
  return { ok: true, value: { workspaceId, deleted: true, id } };
};

export const teamCapture: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const captured = captureSessionPlaybook(runtime, sessionId);
  if (!captured) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "session has no user message to capture" },
    };
  }
  const args = remoteArgs(payload);
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const scope = parseRosterScope(args.scope);
  const name = String(args.name ?? "").trim() || captured.name;
  const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
    name,
    playbook: captured.playbook,
    role: "worker",
  });
  if (!member) {
    return { ok: false, error: { code: "invalid-payload", message: "could not save member" } };
  }
  return { ok: true, value: { workspaceId: scope === "global" ? "global" : canvasId, member } };
};

export const teamDispatch: FaceHandler = async (runtime, rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const memberId = String(args.memberId ?? args.id ?? "").trim();
  const task = String(args.task ?? "").trim();
  if (!task) {
    return { ok: false, error: { code: "invalid-payload", message: "task required" } };
  }
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const member = runtime.agentRoster.get(workspaceId, memberId);
  if (!member) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown member id" } };
  }
  const created = await sessionCreate(runtime, `${rpcId}-c`, {
    parentSessionId: sessionId,
    label: member.name,
    role: member.role,
    memberId: member.id,
    mode: "continuable",
  });
  if (!created.ok) return created;
  const childId = String(
    (created.value as { sessionId?: string }).sessionId ?? "",
  );
  const auth = rootUserAuthorizationBlock({
    parentEvents: readSessionEvents(runtime.store, sessionId),
  });
  const prompt = applySubagentSpawnPreamble({
    prompt: `${member.playbook.trim()}\n\nTASK:\n${task}`,
    parentSessionId: sessionId,
    childSessionId: childId,
    mode: "continuable",
    label: member.name,
    role: member.role,
    inheritContext: false,
    cwd: resolveSessionCwd(runtime, sessionId),
    isolatedWorktree: false,
    memberId: member.id,
    inject: member.inject,
    ...(auth ? { userAuthorization: auth } : {}),
  });
  const prompted = await sessionPrompt(runtime, `${rpcId}-p`, {
    sessionId: childId,
    mode: "queue",
    content: [{ type: "text", text: prompt }],
  });
  if (!prompted.ok) return prompted;
  return {
    ok: true,
    value: { workspaceId, memberId: member.id, childSessionId: childId },
  };
};
