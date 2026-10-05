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
  const deliveryRaw = p.delivery
  const delivery =
    deliveryRaw === "steer" || deliveryRaw === "queue" ? deliveryRaw : "queue"
  if (runtime.externalAgents.has(childSessionId)) {
    const message = contentPartsToText(p.content);
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
      // queue while busy: reject honestly (model should wait_agent); steer interrupts first.
      if (delivery === "queue" && runtime.externalAgents.isBusy(childSessionId)) {
        return {
          ok: false,
          error: {
            code: "subagent-busy",
            message: `${childSessionId} is busy; use wait_agent or delivery=steer`,
            details: { parentSessionId, childSessionId },
          },
        };
      }
      await promptExternalContinuable(runtime, childSessionId, message, {
        steer: delivery === "steer",
      });
      runtime.agentTeamTasks.markResumed(childSessionId);
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
  });
  if (!prompted.ok) return prompted;
  runtime.agentTeamTasks.markResumed(childSessionId);
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
  runtime.suppressOwnedSubagentCompletion(childSessionId);
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
