import { asRecord, type FaceHandler } from "./types.js";
import { sessionCancel, sessionHistory, sessionPrompt } from "./session.js";

function parentAvailable(runtime: Parameters<FaceHandler>[0], parentSessionId: string): boolean {
  return runtime.store.has(parentSessionId);
}

export const subagentList: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const parentSessionId = String(p.parentSessionId ?? "").trim();
  if (!parentSessionId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "parentSessionId required",
      },
    };
  }
  const available = parentAvailable(runtime, parentSessionId);
  const entries = runtime.subagents.list(parentSessionId).map((link) => {
    if (!runtime.store.has(link.childSessionId)) {
      return {
        kind: "diagnostic" as const,
        id: link.childSessionId,
        reason: "unavailable" as const,
      };
    }
    const activity = runtime.drain.isActive(link.childSessionId)
      ? ("running" as const)
      : ("inactive" as const);
    const hasChildren = runtime.subagents.hasChildren(link.childSessionId);
    if (link.mode === "one-shot") {
      return {
        kind: "child" as const,
        id: link.childSessionId,
        mode: "one-shot" as const,
        activity,
        hasChildren,
        ...(link.label ? { label: link.label } : {}),
      };
    }
    return {
      kind: "child" as const,
      id: link.childSessionId,
      mode: "continuable" as const,
      activity,
      hasChildren,
      label: link.label || "subagent",
    };
  });
  return {
    ok: true,
    value: { entries, parentAvailable: available },
  };
};

export const subagentHistory: FaceHandler = async (runtime, rpcId, payload) => {
  const p = asRecord(payload);
  const parentSessionId = String(p.parentSessionId ?? "").trim();
  const childSessionId = String(p.childSessionId ?? "").trim();
  if (!parentSessionId || !childSessionId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "parentSessionId and childSessionId required",
      },
    };
  }
  if (!parentAvailable(runtime, parentSessionId)) {
    return {
      ok: false,
      error: {
        code: "subagent-parent-unavailable",
        message: parentSessionId,
        details: { parentSessionId },
      },
    };
  }
  const link = runtime.subagents.get(parentSessionId, childSessionId);
  if (!link) {
    return {
      ok: false,
      error: {
        code: "subagent-not-found",
        message: childSessionId,
        details: { parentSessionId, childSessionId },
      },
    };
  }
  return sessionHistory(runtime, rpcId, {
    sessionId: childSessionId,
    ...(typeof p.beforeSeq === "number" ? { beforeSeq: p.beforeSeq } : {}),
    ...(typeof p.maxMessages === "number" ? { maxMessages: p.maxMessages } : {}),
  });
};

export const subagentPrompt: FaceHandler = async (runtime, rpcId, payload) => {
  const p = asRecord(payload);
  const parentSessionId = String(p.parentSessionId ?? "").trim();
  const childSessionId = String(p.childSessionId ?? "").trim();
  const mode = String(p.mode ?? "");
  if (!parentSessionId || !childSessionId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "parentSessionId and childSessionId required",
      },
    };
  }
  if (!parentAvailable(runtime, parentSessionId)) {
    return {
      ok: false,
      error: {
        code: "subagent-parent-unavailable",
        message: parentSessionId,
        details: { parentSessionId },
      },
    };
  }
  const link = runtime.subagents.get(parentSessionId, childSessionId);
  if (!link) {
    return {
      ok: false,
      error: {
        code: "subagent-not-found",
        message: childSessionId,
        details: { parentSessionId, childSessionId },
      },
    };
  }
  if (link.mode !== "continuable" || mode !== "continuable") {
    return {
      ok: false,
      error: {
        code: "subagent-not-resumable",
        message: childSessionId,
        details: { parentSessionId, childSessionId },
      },
    };
  }
  const prompted = await sessionPrompt(runtime, rpcId, {
    sessionId: childSessionId,
    mode: "queue",
    content: p.content,
    ...(typeof p.clientTimeZone === "string"
      ? { clientTimeZone: p.clientTimeZone }
      : {}),
  });
  if (!prompted.ok) return prompted;
  const messageId = runtime.rpcAdmitMap.get(rpcId) ?? rpcId;
  return { ok: true, value: { messageId } };
};

export const subagentInterrupt: FaceHandler = async (runtime, rpcId, payload) => {
  const p = asRecord(payload);
  const parentSessionId = String(p.parentSessionId ?? "").trim();
  const childSessionId = String(p.childSessionId ?? "").trim();
  const mode = String(p.mode ?? "");
  if (!parentSessionId || !childSessionId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "parentSessionId and childSessionId required",
      },
    };
  }
  if (!parentAvailable(runtime, parentSessionId)) {
    return {
      ok: false,
      error: {
        code: "subagent-parent-unavailable",
        message: parentSessionId,
        details: { parentSessionId },
      },
    };
  }
  const link = runtime.subagents.get(parentSessionId, childSessionId);
  if (!link) {
    return {
      ok: false,
      error: {
        code: "subagent-not-found",
        message: childSessionId,
        details: { parentSessionId, childSessionId },
      },
    };
  }
  if (link.mode !== "continuable" || (mode && mode !== "continuable")) {
    return {
      ok: false,
      error: {
        code: "subagent-not-resumable",
        message: childSessionId,
        details: { parentSessionId, childSessionId },
      },
    };
  }
  await sessionCancel(runtime, rpcId, { sessionId: childSessionId });
  return { ok: true, value: { accepted: true as const } };
};
