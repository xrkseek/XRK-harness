/**
 * Package-owned relational invariants for the Face session event log.
 * Load beside `@xrkseek/runtime-invariants` to enable live fail-fast checks.
 *
 * @module @xrkseek/core-session/invariant
 */

import type { SessionEvent } from "@xrkseek/protocol";
import type {
  InvariantFailure,
  InvariantInstaller,
  InvariantRegistry,
} from "@xrkseek/runtime-invariants";

const PACKAGE_NAME = "@xrkseek/core-session";

/** Per-session bookkeeping for relational log checks. */
interface SessionTrace {
  openTurnId: string | null;
  openStepId: string | null;
  pendingCalls: Set<string>;
}

function requireOpenStep(
  trace: SessionTrace,
  kind: string,
  turnId: string,
  stepId: string,
  fail: InvariantFailure,
): void {
  if (trace.openTurnId !== turnId || trace.openStepId !== stepId) {
    fail(
      `${kind} names turn ${turnId}/step ${stepId} but open is turn ${trace.openTurnId}/step ${trace.openStepId}`,
    );
  }
}

/** Validate one candidate event and mutate the committed trace on success. */
function observeEvent(
  trace: SessionTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  switch (event.type) {
    case "turn/start": {
      if (trace.openTurnId !== null) {
        fail(
          `turn/start ${event.turnId} while turn ${trace.openTurnId} is still open`,
        );
      }
      trace.openTurnId = event.turnId;
      trace.openStepId = null;
      trace.pendingCalls.clear();
      break;
    }
    case "turn/end": {
      if (trace.openTurnId !== event.turnId) {
        fail(
          `turn/end ${event.turnId} does not match open turn ${trace.openTurnId}`,
        );
      }
      if (trace.openStepId !== null) {
        fail(
          `turn/end ${event.turnId} while step ${trace.openStepId} is still open`,
        );
      }
      trace.openTurnId = null;
      trace.pendingCalls.clear();
      break;
    }
    case "step/start": {
      if (trace.openTurnId !== event.turnId) {
        fail(
          `step/start in turn ${event.turnId} but open turn is ${trace.openTurnId}`,
        );
      }
      if (trace.openStepId !== null) {
        fail(
          `step/start ${event.stepId} while step ${trace.openStepId} is still open`,
        );
      }
      trace.openStepId = event.stepId;
      break;
    }
    case "step/end": {
      requireOpenStep(
        trace,
        "step/end",
        event.turnId,
        event.stepId,
        fail,
      );
      trace.openStepId = null;
      trace.pendingCalls.clear();
      break;
    }
    case "assistant/chunk":
    case "assistant/message": {
      requireOpenStep(
        trace,
        event.type,
        event.turnId,
        event.stepId,
        fail,
      );
      break;
    }
    case "tool/call": {
      requireOpenStep(
        trace,
        "tool/call",
        event.turnId,
        event.stepId,
        fail,
      );
      trace.pendingCalls.add(event.call.id);
      break;
    }
    case "tool/result": {
      requireOpenStep(
        trace,
        "tool/result",
        event.turnId,
        event.stepId,
        fail,
      );
      const callId = event.result.toolCallId;
      if (!trace.pendingCalls.has(callId)) {
        fail(`tool/result for ${callId} with no prior tool/call in this step`);
      }
      trace.pendingCalls.delete(callId);
      break;
    }
    default:
      // Merge-extensible / context-only events are owned by their packages.
      break;
  }
}

function freshTrace(): SessionTrace {
  return {
    openTurnId: null,
    openStepId: null,
    pendingCalls: new Set(),
  };
}

/** Pure check over a complete log prefix (tests / Host boot replay). */
export function assertSessionLogInvariants(
  events: readonly SessionEvent[],
  fail: InvariantFailure = (message): never => {
    throw new Error(message);
  },
): void {
  const trace = freshTrace();
  for (const event of events) {
    observeEvent(trace, event, fail);
  }
}

/** Installer for {@link InvariantRegistry.register}. */
export const install: InvariantInstaller = (api, fail) => {
  const traces = new Map<string, SessionTrace>();

  api.onAppend(({ sessionId, event, prefix }) => {
    let trace = traces.get(sessionId);
    if (trace === undefined) {
      trace = freshTrace();
      for (const prior of prefix) {
        observeEvent(trace, prior, fail);
      }
      traces.set(sessionId, trace);
    }
    observeEvent(trace, event, fail);
  });
};

/**
 * Register this package's invariant companion on a Face/Host registry.
 * @returns disposer that releases ownership and listeners.
 */
export function installCoreSessionInvariant(
  registry: InvariantRegistry,
): () => void {
  return registry.register(PACKAGE_NAME, install);
}
