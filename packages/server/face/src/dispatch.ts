import type { FaceRpcResult } from "./types.js";
import type { FaceRuntime } from "./context.js";
import { U1_AGENT_PRESETS } from "./context.js";
import { errResponse, okResponse } from "./envelope.js";
import type { FaceRpcResponse } from "./types.js";
import { SessionTitleInvalidError } from "./projections/index.js";
import { toWireHistoryEntry } from "./adapt/index.js";
import { tryFaceSlashCommand } from "./slash.js";
import { FACE_AGENT_PRESETS, FACE_AGENT_PRESET_IDS } from "./presets-catalog.js";
import {
  workspaceDescribe,
  workspaceListProduct,
  workspacePreviewInject,
  workspaceSyncSeeds,
} from "./workspace-face.js";
import {
  credentialsList,
  credentialsSet,
  settingsGet,
  settingsSet,
} from "./settings-credentials.js";
import {
  AdmitNotPendingError,
  admitPrompt,
  listPendingAdmits,
  withdrawAdmit,
} from "@xrkseek/core-session";
import { assertPolicyAllow } from "@xrkseek/policy";

type FaceHandler = (
  runtime: FaceRuntime,
  rpcId: string,
  payload: unknown,
) => Promise<FaceRpcResult<unknown>>;

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

const notImplemented: FaceHandler = async () => ({
  ok: false,
  error: { code: "not-implemented", message: "not implemented in Face" },
});

const hostDescribe: FaceHandler = async (runtime) => {
  const routable = runtime.registry.listRoutable();
  const first = routable.find((r) => r.active) ?? routable[0];
  return {
    ok: true,
    value: {
      version: runtime.version,
      cwd: runtime.workspaceRoot,
      ...(first ? { provider: first.id } : {}),
      attachedSessions: runtime.store.list().length,
      canOpenPath: false,
    },
  };
};

const sessionCreate: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const agentPreset =
    typeof p.agentPreset === "string" ? p.agentPreset : undefined;
  if (agentPreset && !U1_AGENT_PRESETS.has(agentPreset)) {
    return {
      ok: false,
      error: {
        code: "agent-preset-not-found",
        message: `unknown agentPreset: ${agentPreset}`,
      },
    };
  }
  const sessionId =
    typeof p.sessionId === "string" && p.sessionId.trim()
      ? runtime.ensureSession(p.sessionId.trim())
      : runtime.ensureSession();
  runtime.watchSession(sessionId);
  if (agentPreset) {
    runtime.sessionAgentPresets.set(sessionId, agentPreset);
  } else if (runtime.defaultAgentPreset) {
    runtime.sessionAgentPresets.set(sessionId, runtime.defaultAgentPreset);
  }
  const bound =
    runtime.sessionAgentPresets.get(sessionId) ?? agentPreset;
  runtime.bus.publishHost({
    type: "host/session-added",
    sessionId,
    blank: true,
    ...(bound ? { agentPreset: bound } : {}),
  });
  return {
    ok: true,
    value: {
      sessionId,
      ...(bound ? { agentPreset: bound } : {}),
    },
  };
};

const sessionList: FaceHandler = async (runtime) => {
  const items = runtime.store.list().map((sessionId) => {
    const events = runtime.store.get(sessionId).events;
    const last = events[events.length - 1];
    const snap = runtime.projections.snapshot(sessionId);
    const meta = snap.values.sessionListMetadata;
    const blank =
      meta?.blank ?? !events.some((e) => e.type === "turn/start");
    const lastPromptAt = meta?.lastPromptAt ?? null;
    const updatedAt = Math.max(last?.ts ?? 0, lastPromptAt ?? 0);
    return {
      sessionId,
      updatedAt,
      running: runtime.drain.isActive(sessionId),
      blank,
      title: snap.values.title ?? null,
      projections: {
        asOfSeq: snap.asOfSeq,
        values: snap.values,
      },
    };
  });
  return { ok: true, value: { items } };
};

const sessionHistory: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const events = runtime.store.get(sessionId).events;

  const beforeSeq =
    typeof p.beforeSeq === "number" ? p.beforeSeq : undefined;
  const maxMessages =
    typeof p.maxMessages === "number" ? p.maxMessages : 100;

  // Face seq = 1-based index in full log
  let indexed = events.map((event, i) => toWireHistoryEntry(event, i + 1));
  if (beforeSeq !== undefined) {
    indexed = indexed.filter((e) => e.seq < beforeSeq);
  }
  const hasMore = indexed.length > maxMessages;
  if (hasMore) {
    indexed = indexed.slice(-maxMessages);
  }
  // Align Face seq clock to at least max seen
  for (const row of indexed) {
    while (runtime.seq.last(sessionId) < row.seq) {
      runtime.seq.next(sessionId);
    }
  }

  const snap = runtime.projections.snapshot(sessionId);
  const projections =
    Object.keys(snap.values).length > 0
      ? { asOfSeq: snap.asOfSeq, values: snap.values }
      : undefined;

  return {
    ok: true,
    value: {
      events: indexed,
      hasMore,
      ...(projections ? { projections } : {}),
    },
  };
};

const sessionPrompt: FaceHandler = async (runtime, rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const mode = p.mode;
  const content = Array.isArray(p.content) ? p.content : [];
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (mode !== "queue" && mode !== "steer") {
    return {
      ok: false,
      error: { code: "invalid-mode", message: "mode must be queue|steer" },
    };
  }
  type Part = { type?: string; text?: string };
  const parts = content as Part[];
  if (parts.some((x) => x?.type === "image")) {
    return {
      ok: false,
      error: { code: "not-implemented", message: "image parts" },
    };
  }
  const text = parts
    .filter((x) => x?.type === "text")
    .map((x) => x.text ?? "")
    .join("");

  if (parts.length === 1 && parts[0]?.type === "text" && text.startsWith("/")) {
    const slash = await tryFaceSlashCommand(text, runtime.loadSlashRecipes);
    if (slash) return slash;
  }

  runtime.watchSession(sessionId);
  const agent = await runtime.resolveAgent(sessionId);
  const receipt = agent.admit(text, {
    delivery: mode === "steer" ? "steer" : "queue",
  });
  runtime.rpcAdmitMap.set(rpcId, receipt.admitId);
  runtime.admitRpcMap.set(receipt.admitId, rpcId);
  runtime.publishQueue(sessionId);
  runtime.bus.publishHost({
    type: "host/session-status",
    sessionId,
    running: true,
  });
  runtime.drain.wake(sessionId);
  // Non-blocking: schedule status clear when drain settles (best-effort)
  void Promise.resolve()
    .then(async () => {
      // poll briefly for drain idle
      for (let i = 0; i < 50; i++) {
        if (!runtime.drain.isActive(sessionId)) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      runtime.bus.publishHost({
        type: "host/session-status",
        sessionId,
        running: runtime.drain.isActive(sessionId),
      });
    })
    .catch((err: unknown) => {
      runtime.bus.publishHost({
        type: "host/agent-error",
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    });

  return { ok: true, value: { accepted: true } };
};

const sessionCancel: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = String(asRecord(payload).sessionId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  await runtime.drain.cancel(sessionId);
  try {
    const agent = await runtime.resolveAgent(sessionId);
    agent.abort();
  } catch {
    /* ignore */
  }
  runtime.bus.publishHost({
    type: "host/session-status",
    sessionId,
    running: false,
  });
  return { ok: true, value: { accepted: true } };
};

const sessionModels: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = String(asRecord(payload).sessionId ?? "");
  const brands = runtime.registry.listBrands();
  const routableRows = runtime.registry.listRoutable();
  const current =
    runtime.sessionModels.get(sessionId) ??
    (() => {
      const active = routableRows.find((r) => r.active);
      if (!active) return { provider: "deepseek", model: "deepseek-chat" };
      const brand = brands.find((b) => b.id === active.id);
      return {
        provider: active.id,
        model: brand?.defaultModel ?? "gpt-4o-mini",
      };
    })();
  const groups = brands
    .filter((b) => b.baseUrl || b.id === "ollama")
    .map((b) => ({
      id: b.id,
      name: b.displayName,
      models: [
        {
          id: b.defaultModel ?? "default",
          name: b.defaultModel ?? "default",
        },
      ],
    }));
  const routable = routableRows.some(
    (r) => r.id === current.provider && r.active,
  );
  return {
    ok: true,
    value: {
      current,
      routable,
      groups,
      failures: [],
    },
  };
};

const sessionSelectModel: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const provider = String(p.provider ?? "");
  const model = String(p.model ?? "");
  if (!sessionId || !provider || !model) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId, provider, model required",
      },
    };
  }
  try {
    runtime.registry.resolve({ provider, model });
  } catch {
    return {
      ok: false,
      error: {
        code: "provider-not-found",
        message: `unknown provider: ${provider}`,
      },
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
  const selected = { provider, model };
  runtime.sessionModels.set(sessionId, selected);
  return { ok: true, value: { selected } };
};

const sessionFork: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  try {
    runtime.store.get(sessionId);
  } catch {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }

  const beforeSeq =
    typeof p.beforeSeq === "number" && Number.isFinite(p.beforeSeq)
      ? Math.floor(p.beforeSeq)
      : undefined;
  if (beforeSeq !== undefined && beforeSeq < 0) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "beforeSeq must be >= 0",
      },
    };
  }

  const preferredChild =
    typeof p.newSessionId === "string" && p.newSessionId.trim()
      ? p.newSessionId.trim()
      : undefined;
  if (preferredChild) {
    try {
      runtime.store.get(preferredChild);
      return {
        ok: false,
        error: {
          code: "session-exists",
          message: preferredChild,
        },
      };
    } catch {
      /* free id */
    }
  }

  // Face seq is 1-based index; forkSession boundary is exclusive end index.
  const boundary =
    beforeSeq === undefined
      ? undefined
      : beforeSeq === 0
        ? 0
        : beforeSeq;

  const child = runtime.forkSession(
    sessionId,
    boundary,
    preferredChild,
  );

  const parentModel = runtime.sessionModels.get(sessionId);
  if (parentModel) {
    runtime.sessionModels.set(child.id, { ...parentModel });
  }
  const parentPreset = runtime.sessionAgentPresets.get(sessionId);
  if (parentPreset) {
    runtime.sessionAgentPresets.set(child.id, parentPreset);
  }

  runtime.watchSession(child.id);
  return {
    ok: true,
    value: {
      sessionId: child.id,
      parentSessionId: sessionId,
      eventCount: child.events.length,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    },
  };
};

const sessionRespondApproval: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const approvalId = String(p.approvalId ?? "");
  const decisionRaw = String(p.decision ?? "");
  if (!sessionId || !approvalId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId and approvalId required",
      },
    };
  }
  if (decisionRaw !== "allow" && decisionRaw !== "deny") {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: 'decision must be "allow" | "deny"',
      },
    };
  }
  try {
    runtime.store.get(sessionId);
  } catch {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }
  const out = runtime.approvals.respond(sessionId, approvalId, decisionRaw);
  if (!out.ok) {
    return {
      ok: false,
      error: { code: out.code, message: out.message },
    };
  }
  return {
    ok: true,
    value: { sessionId, approvalId, decision: decisionRaw },
  };
};

const llmProviders: FaceHandler = async (runtime) => {
  const routable = new Map(
    runtime.registry.listRoutable().map((r) => [r.id, r]),
  );
  const providers = runtime.registry.listBrands().map((b) => ({
    provider: b.id,
    displayName: b.displayName,
    settingsNs: "llm",
    settingsPath: [] as string[],
    active: routable.get(b.id)?.active ?? false,
  }));
  return { ok: true, value: { providers } };
};

const llmModels: FaceHandler = async (runtime) => {
  const groups = runtime.registry
    .listBrands()
    .filter((b) => b.baseUrl || b.id === "ollama")
    .map((b) => ({
      id: b.id,
      name: b.displayName,
      models: [
        {
          id: b.defaultModel ?? "default",
          name: b.defaultModel ?? "default",
        },
      ],
    }));
  return { ok: true, value: { groups, failures: [] } };
};

const sessionRename: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const titleRaw = p.title;
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (typeof titleRaw !== "string") {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "title string required" },
    };
  }
  try {
    runtime.store.get(sessionId);
  } catch {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }
  try {
    const title = runtime.titles.rename(sessionId, titleRaw);
    return { ok: true, value: { title } };
  } catch (err) {
    if (err instanceof SessionTitleInvalidError) {
      return {
        ok: false,
        error: { code: "title-invalid", message: err.message },
      };
    }
    throw err;
  }
};

const sessionUpdateQueue: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const itemId = String(p.itemId ?? "");
  const action = p.action;
  if (!sessionId || !itemId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId and itemId required",
      },
    };
  }
  if (!action || typeof action !== "object" || !("kind" in action)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "action.kind required" },
    };
  }
  const kind = Reflect.get(action, "kind");
  const pending = listPendingAdmits(
    runtime.store.get(sessionId).events,
    sessionId,
  );
  const target = pending.find((a) => a.admitId === itemId);
  if (!target) {
    return {
      ok: false,
      error: { code: "queue-item-not-found", message: itemId },
    };
  }

  try {
    if (kind === "remove") {
      withdrawAdmit(runtime.store, sessionId, itemId);
      runtime.admitRpcMap.delete(itemId);
    } else if (kind === "steer") {
      withdrawAdmit(runtime.store, sessionId, itemId);
      const rpc = runtime.admitRpcMap.get(itemId);
      runtime.admitRpcMap.delete(itemId);
      const receipt = admitPrompt(runtime.store, sessionId, target.content, {
        delivery: "steer",
      });
      if (rpc) runtime.admitRpcMap.set(receipt.admitId, rpc);
    } else if (kind === "edit") {
      const content = (action as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        return {
          ok: false,
          error: { code: "invalid-payload", message: "edit.content required" },
        };
      }
      type Part = { type?: string; text?: string };
      const text = (content as Part[])
        .filter((x) => x?.type === "text")
        .map((x) => x.text ?? "")
        .join("");
      if (!text.trim()) {
        return {
          ok: false,
          error: { code: "invalid-payload", message: "edit text empty" },
        };
      }
      withdrawAdmit(runtime.store, sessionId, itemId);
      const rpc = runtime.admitRpcMap.get(itemId);
      runtime.admitRpcMap.delete(itemId);
      const receipt = admitPrompt(runtime.store, sessionId, text, {
        delivery: target.delivery,
      });
      if (rpc) runtime.admitRpcMap.set(receipt.admitId, rpc);
    } else {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: "action.kind must be edit|remove|steer",
        },
      };
    }
  } catch (err) {
    if (err instanceof AdmitNotPendingError) {
      return {
        ok: false,
        error: { code: "queue-item-not-found", message: err.message },
      };
    }
    throw err;
  }

  runtime.publishQueue(sessionId);
  return { ok: true, value: { accepted: true } };
};

const agentPresetList: FaceHandler = async () => ({
  ok: true,
  value: { items: FACE_AGENT_PRESETS },
});

const agentPresetSelect: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  const agentPreset = String(p.agentPreset ?? "");
  if (!sessionId || !agentPreset) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId and agentPreset required",
      },
    };
  }
  if (!FACE_AGENT_PRESET_IDS.has(agentPreset)) {
    return {
      ok: false,
      error: {
        code: "agent-preset-not-found",
        message: `unknown agentPreset: ${agentPreset}`,
      },
    };
  }
  try {
    runtime.store.get(sessionId);
  } catch {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }
  runtime.sessionAgentPresets.set(sessionId, agentPreset);
  runtime.invalidateAgent?.(sessionId);
  return { ok: true, value: { sessionId, agentPreset } };
};

const HANDLERS: Record<string, FaceHandler> = {
  "host.describe": hostDescribe,
  "session.create": sessionCreate,
  "session.list": sessionList,
  "session.history": sessionHistory,
  "session.prompt": sessionPrompt,
  "session.cancel": sessionCancel,
  "session.models": sessionModels,
  "session.selectModel": sessionSelectModel,
  "session.rename": sessionRename,
  "session.updateQueue": sessionUpdateQueue,
  "session.fork": sessionFork,
  "session.respondApproval": sessionRespondApproval,
  "agentPreset.list": agentPresetList,
  "agentPreset.select": agentPresetSelect,
  "llm.providers": llmProviders,
  "llm.models": llmModels,
  "workspace.describe": async (runtime) => workspaceDescribe(runtime),
  "workspace.listProduct": async (runtime) => workspaceListProduct(runtime),
  "workspace.previewInject": async (runtime, _rpcId, payload) =>
    workspacePreviewInject(runtime, payload),
  "workspace.syncSeeds": async (runtime, _rpcId, payload) =>
    workspaceSyncSeeds(runtime, payload),
  "settings.get": async (runtime, _rpcId, payload) =>
    settingsGet(runtime, payload),
  "settings.set": async (runtime, _rpcId, payload) =>
    settingsSet(runtime, payload),
  "credentials.list": async (runtime) => credentialsList(runtime),
  "credentials.set": async (runtime, _rpcId, payload) =>
    credentialsSet(runtime, payload),
  // explicit not-implemented
  "session.attachment": notImplemented,
  "session.search": notImplemented,
  "llm.discoverModels": notImplemented,
  "agentPreset.read": notImplemented,
  "agentPreset.copy": notImplemented,
  "agentPreset.openDocument": notImplemented,
  "agentPreset.remove": notImplemented,
};

export function getHandler(method: string): FaceHandler | undefined {
  return HANDLERS[method];
}

export async function dispatchFaceMethod(
  runtime: FaceRuntime,
  method: string,
  rpcId: string,
  payload: unknown,
): Promise<FaceRpcResponse> {
  const handler = HANDLERS[method] ?? notImplemented;
  try {
    const result = await handler(runtime, rpcId, payload);
    if (result.ok) return okResponse(rpcId, result.value);
    return errResponse(rpcId, result.error.code, result.error.message);
  } catch (err) {
    return errResponse(
      rpcId,
      "internal",
      err instanceof Error ? err.message : String(err),
    );
  }
}
