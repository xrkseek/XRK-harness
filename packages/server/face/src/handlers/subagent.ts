import { asRecord, type FaceHandler } from "./types.js";
import { sessionCancel, sessionHistory, sessionPrompt } from "./session.js";
import {
  contentPartsToText,
  interruptExternalContinuable,
  isChildSessionActive,
  promptExternalContinuable,
} from "../external-agent-runtime.js";
import { resolveSessionModelSelection } from "../model-catalog.js";
import { describeChildOutcome } from "../adapt/subagent-notice.js";
import { readSessionEvents } from "@xrkseek/core-session";

function parentAvailable(runtime: Parameters<FaceHandler>[0], parentSessionId: string): boolean {
  return runtime.store.has(parentSessionId);
}

/** Model-facing text. The code stays on `error.code`; `message` must not be a bare id. */
function subagentFail(
  code:
    | "subagent-parent-unavailable"
    | "subagent-not-found"
    | "subagent-not-resumable",
  parentSessionId: string,
  childSessionId = "",
): {
  ok: false;
  error: {
    code: typeof code;
    message: string;
    details: { parentSessionId: string; childSessionId?: string };
  };
} {
  const message =
    code === "subagent-parent-unavailable"
      ? `Parent session ${parentSessionId} is gone; cannot reach its children.`
      : code === "subagent-not-found"
        ? `No child ${childSessionId} under this parent. Use an id from list_agents or subagent.`
        : `Child ${childSessionId} is not continuable. followup_task and send_message need a continuable child; one-shot sessions are read-only.`;
  return {
    ok: false,
    error: {
      code,
      message,
      details: {
        parentSessionId,
        ...(childSessionId ? { childSessionId } : {}),
      },
    },
  };
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
  const entries = runtime.subagents.listDelegated(parentSessionId).map((link) => {
    if (!runtime.store.has(link.childSessionId)) {
      return {
        kind: "diagnostic" as const,
        id: link.childSessionId,
        reason: "unavailable" as const,
      };
    }
    // The route the child runs on, not the one it was spawned with: a child
    // created before this field existed has no `sessionModels` entry and still
    // resolves through the default chain, so reading the effective selection
    // is what makes the row true rather than merely seeded. An external child
    // gets none — its CLI owns that choice, and a Face route would be fiction.
    const external = runtime.externalAgents.kind(link.childSessionId);
    const route = external
      ? undefined
      : (() => {
          const m = resolveSessionModelSelection(runtime, link.childSessionId);
          return `${m.provider}/${m.model}`;
        })();
    const activity = isChildSessionActive(runtime, link.childSessionId)
      ? ("running" as const)
      : ("inactive" as const);
    const outcome = describeChildOutcome(
      readSessionEvents(runtime.store, link.childSessionId),
    );
    const hasChildren = runtime.subagents.hasDelegatedChildren(
      link.childSessionId,
    );
    if (link.mode === "one-shot") {
      return {
        kind: "child" as const,
        id: link.childSessionId,
        mode: "one-shot" as const,
        activity,
        outcome,
        hasChildren,
        ...(route ? { model: route } : {}),
        ...(link.label ? { label: link.label } : {}),
      };
    }
    return {
      kind: "child" as const,
      id: link.childSessionId,
      mode: "continuable" as const,
      activity,
      outcome,
      hasChildren,
      ...(route ? { model: route } : {}),
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
    return subagentFail("subagent-parent-unavailable", parentSessionId);
  }
  const link = runtime.subagents.get(parentSessionId, childSessionId);
  if (!link) {
    return subagentFail("subagent-not-found", parentSessionId, childSessionId);
  }
  return sessionHistory(runtime, rpcId, {
    sessionId: childSessionId,
    ...(typeof p.beforeSeq === "number" ? { beforeSeq: p.beforeSeq } : {}),
    ...(typeof p.maxMessages === "number" ? { maxMessages: p.maxMessages } : {}),
  });
};

/**
 * Face tool / orchestrator dispatches mint stable rpcId prefixes; human UI
 * clients send UUIDs. Used to skip parent-mirror duplication when the parent
 * already authored the follow-up via send_message / followup_task.
 */
function isInternalFaceRpc(rpcId: string): boolean {
  return /^(tool-|orch-|te-|delete-)/.test(rpcId);
}

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
    return subagentFail("subagent-parent-unavailable", parentSessionId);
  }
  const link = runtime.subagents.get(parentSessionId, childSessionId);
  if (!link) {
    return subagentFail("subagent-not-found", parentSessionId, childSessionId);
  }
  if (link.mode !== "continuable" || mode !== "continuable") {
    return subagentFail("subagent-not-resumable", parentSessionId, childSessionId);
  }
  const deliveryRaw = p.delivery
  // Session collaboration defaults to steer (插队 at the next tool boundary).
  const delivery =
    deliveryRaw === "queue" || deliveryRaw === "steer" ? deliveryRaw : "steer"
  const preview = contentPartsToText(p.content);
  const mirrorHuman = !isInternalFaceRpc(rpcId);
  if (runtime.externalAgents.has(childSessionId)) {
    const message = preview;
    if (!message) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: "external follow-up requires text content",
        },
      };
    }
    try {
      if (delivery === "queue" && runtime.externalAgents.isBusy(childSessionId)) {
        return {
          ok: false,
          error: {
            code: "subagent-busy",
            message: `${childSessionId} is busy; use delivery=steer`,
            details: { parentSessionId, childSessionId },
          },
        };
      }
      await promptExternalContinuable(runtime, childSessionId, message, {
        steer: delivery === "steer",
      });
      runtime.agentTeamTasks.markResumed(childSessionId);
      if (mirrorHuman) {
        runtime.notifyOwnedSubagentUserPrompt(childSessionId, message);
      }
      return { ok: true, value: { messageId: rpcId } };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "external-agent-failed",
          message: err instanceof Error ? err.message : String(err),
          details: { parentSessionId, childSessionId },
        },
      };
    }
  }
  const prompted = await sessionPrompt(runtime, rpcId, {
    sessionId: childSessionId,
    mode: delivery,
    content: p.content,
    ...(typeof p.clientTimeZone === "string"
      ? { clientTimeZone: p.clientTimeZone }
      : {}),
    // Pass through client beginSubmission identity so Host queue rpcId matches
    // the local echo (same as session.prompt). Face unary rpcId alone left
    // unmatched "发送中" chrome with copy-only until the next steer.
    ...(typeof p.requestId === "string" && p.requestId.length > 0
      ? { requestId: p.requestId }
      : {}),
  });
  if (!prompted.ok) return prompted;
  runtime.agentTeamTasks.markResumed(childSessionId);
  if (mirrorHuman && preview) {
    runtime.notifyOwnedSubagentUserPrompt(childSessionId, preview);
  }
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
    return subagentFail("subagent-parent-unavailable", parentSessionId);
  }
  const link = runtime.subagents.get(parentSessionId, childSessionId);
  if (!link) {
    return subagentFail("subagent-not-found", parentSessionId, childSessionId);
  }
  if (link.mode !== "continuable" || (mode && mode !== "continuable")) {
    return subagentFail("subagent-not-resumable", parentSessionId, childSessionId);
  }
  const reasonRaw = typeof p.reason === "string" ? p.reason : "";
  const stopReason =
    p.takeover === true || reasonRaw === "takeover"
      ? "takeover"
      : reasonRaw === "parent"
        ? "parent"
        : "user";
  runtime.notifyOwnedSubagentStopped(childSessionId, stopReason);
  if (runtime.externalAgents.has(childSessionId)) {
    await interruptExternalContinuable(runtime, childSessionId, {
      dispose: true,
    });
  } else {
    await sessionCancel(runtime, rpcId, { sessionId: childSessionId });
  }
  const takeover = p.takeover === true;
  if (takeover) {
    runtime.agentTeamTasks.markTakeover(childSessionId);
  }
  return {
    ok: true,
    value: {
      accepted: true as const,
      ...(takeover ? { takeover: true as const } : {}),
    },
  };
};
