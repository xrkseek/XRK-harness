/**
 * Shared session model selection (Face RPC + `/model` slash).
 */

import { assertPolicyAllow } from "@xrkseek/policy";
import {
  contentHasImage,
  type MessageContent,
} from "@xrkseek/protocol";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import type { FaceRpcResult } from "./types.js";
import {
  saveAgentDefaultModel,
  type FaceModelSelection,
} from "./model-catalog.js";
import { resolveLlmForSelection } from "./llm-resolve.js";
import { publishRemoteEvent } from "./remote-event.js";

function sessionHasImageContent(
  runtime: FaceRuntime,
  sessionId: string,
): boolean {
  if (runtime.sessionHasImage.has(sessionId)) return true;
  if (runtime.sessionImageScanned.has(sessionId)) return false;
  for (const ev of readSessionEvents(runtime.store, sessionId)) {
    if (ev.type !== "user/message" && ev.type !== "prompt/admitted") continue;
    const content = (ev as { content?: MessageContent }).content;
    if (content !== undefined && contentHasImage(content)) {
      runtime.sessionHasImage.add(sessionId);
      runtime.sessionImageScanned.add(sessionId);
      return true;
    }
  }
  runtime.sessionImageScanned.add(sessionId);
  return false;
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
      error: { code: "session-not-found", message: sessionId },
    };
  }
  if (runtime.policy) {
    try {
      assertPolicyAllow(runtime.policy, {
        kind: "provider.use",
        providerId: provider,
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "policy-denied",
          message: err instanceof Error ? err.message : String(err),
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
  let resolved;
  try {
    resolved = resolveLlmForSelection(runtime, selected);
  } catch (err) {
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
  const modalities = resolved.adapter.inputModalities ?? ["text"];
  if (sessionHasImageContent(runtime, sessionId) && !modalities.includes("image")) {
    return {
      ok: false,
      error: {
        code: "model-unavailable",
        message: `Model "${model}" does not accept image input, but this session already contains images; select an image-capable model.`,
        details: { provider, model },
      },
    };
  }
  runtime.sessionModels.set(sessionId, selected);
  try {
    await saveAgentDefaultModel(runtime, selected);
    publishRemoteEvent(runtime.bus, "settings/document-updated", [
      "agent-default-model",
      runtime.settingsNamespaces.ensure("agent-default-model").revision,
    ]);
  } catch {
    /* session selection still applies */
  }
  return { ok: true, value: { selected } };
}
