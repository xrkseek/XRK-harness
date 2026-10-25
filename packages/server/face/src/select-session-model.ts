/**
 * Shared session model selection (Face RPC + `/model` slash).
 */

import { assertPolicyAllow, PolicyGateError } from "@xrkseek/policy";
import { sessionNotFoundMessage } from "./face-error-text.js";
import type { FaceRuntime } from "./context.js";
import type { FaceRpcResult } from "./types.js";
import type { FaceModelSelection } from "./model-catalog.js";
import {
  saveSessionModelSelection,
  sessionModelsPath,
} from "./session-model-store.js";
import { resolveXrkHome } from "@xrkseek/server-config";
import { resolveLlmForSelection } from "./llm-resolve.js";
import { reserveModelSessionSlot } from "./model-session-cap.js";
import {
  lookupModelContextWindow,
  resolveSessionModelSelection,
} from "./model-catalog.js";

/**
 * The occupancy ball reads `contextPressure.contextWindow`, and the plan
 * summary reads `contextTimeline.contextWindow`. Both otherwise move only
 * when a turn logs `request/header`. A model switch must publish the catalog
 * window immediately, without inventing a turn-enclosed header.
 */
function publishSelectedContextWindow(
  runtime: FaceRuntime,
  sessionId: string,
  selected: FaceModelSelection,
): void {
  const contextWindow = lookupModelContextWindow(runtime, selected);
  if (contextWindow === undefined) return;
  runtime.projections.revise(sessionId, "contextPressure", (state) => {
    const prev = (state ?? {}) as { contextWindow?: number };
    if (prev.contextWindow === contextWindow) return state;
    return { ...prev, contextWindow };
  });
  runtime.projections.revise(sessionId, "contextTimeline", (state) => {
    const prev = (state ?? {}) as {
      contextWindow?: number;
      model?: string;
      provider?: string;
    };
    if (
      prev.contextWindow === contextWindow &&
      prev.model === selected.model &&
      prev.provider === selected.provider
    ) {
      return state;
    }
    return {
      ...prev,
      contextWindow,
      model: selected.model,
      provider: selected.provider,
    };
  });
}

export async function selectSessionModel(
  runtime: FaceRuntime,
  args: {
    readonly sessionId: string;
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string;
  },
): Promise<FaceRpcResult<{ selected: FaceModelSelection }>> {
  const { sessionId, provider, model } = args;
  if (!sessionId || !provider || !model) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId, provider, model required",
      },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }
  if (runtime.policy) {
    try {
      assertPolicyAllow(runtime.policy, {
        kind: "provider.use",
        providerId: provider,
      });
    } catch (err) {
      if (err instanceof PolicyGateError) {
        return {
          ok: false,
          error: {
            code: err.code,
            message: err.details.reason,
            details: { ...err.details },
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "policy-denied",
          message: err instanceof Error ? err.message : String(err),
          details: { kind: "provider.use", reason: String(err) },
        },
      };
    }
  }
  const selected: FaceModelSelection = {
    provider,
    model,
    ...(args.reasoningEffort?.trim()
      ? { reasoningEffort: args.reasoningEffort.trim() }
      : {}),
  };
  const current = resolveSessionModelSelection(runtime, sessionId);
  const routeChanged =
    current.provider !== selected.provider || current.model !== selected.model;
  // Switching onto a full route must refuse; staying on the same route is free.
  const switchSlot = routeChanged
    ? reserveModelSessionSlot(runtime, selected, {
        excludeSessionId: sessionId,
      })
    : ({ ok: true as const, release: () => undefined });
  if (!switchSlot.ok) {
    return {
      ok: false,
      error: {
        code: "model-session-cap",
        message: switchSlot.problem,
        details: { ...switchSlot.details },
      },
    };
  }
  try {
    // Validates provider/model (and effort) are routable. Image history is
    // fine on a text-only route — assemble projects via projectImagesForTextModel.
    resolveLlmForSelection(runtime, selected);
  } catch (err) {
    switchSlot.release();
    const message = err instanceof Error ? err.message : String(err);
    if (/unknown provider/i.test(message)) {
      return {
        ok: false,
        error: {
          code: "provider-not-found",
          message: `unknown provider: ${provider}`,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "model-unavailable",
        message,
        details: { provider, model },
      },
    };
  }
  runtime.sessionModels.set(sessionId, selected);
  publishSelectedContextWindow(runtime, sessionId, selected);
  try {
    saveSessionModelSelection(
      sessionModelsPath(
        runtime.productDir?.trim() || resolveXrkHome(),
      ),
      sessionId,
      selected,
    );
  } catch {
    /* disk persist best-effort */
  }
  // Live pin now counts — drop the pending credit.
  switchSlot.release();
  // Per-session only — do NOT write Settings `agent-default-model` here.
  // That publish used to fan out `settings/document-updated` → Host
  // `invalidateAgents()` and remount / cut other sessions mid-flight.
  return { ok: true, value: { selected } };
}
