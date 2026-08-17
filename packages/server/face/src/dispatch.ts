import type { FaceRpcResult } from "./types.js";
import type { FaceRuntime } from "./context.js";
import { U1_AGENT_PRESETS } from "./context.js";
import { errResponse, okResponse } from "./envelope.js";
import type { FaceRpcResponse } from "./types.js";
import { SessionTitleInvalidError } from "./projections/index.js";
import { toWireHistoryEntry } from "./adapt/index.js";
import { tryFaceSlashCommand } from "./slash.js";
import { FACE_AGENT_PRESETS, FACE_AGENT_PRESET_IDS } from "./presets-catalog.js";
import path from "node:path";
import {
  workspaceArchiveSessionDsh,
  workspaceCreateDsh,
  workspaceDescribe,
  workspaceListDsh,
  workspaceListProduct,
  workspacePreviewInject,
  workspaceRenameDsh,
  workspaceSyncSeeds,
} from "./workspace-face.js";
import {
  credentialsDescribe,
  credentialsList,
  credentialsSet,
  credentialsUnset,
  settingsDescribeDsh,
  settingsGet,
  settingsMutateDsh,
  settingsReplaceDsh,
  settingsSet,
  settingsUpdateDsh,
} from "./settings-credentials.js";
import {
  hostCreateDirectory,
  hostListDirectory,
} from "./host-directory.js";
import { canOpenNativePath, hostOpenPath } from "./host-open-path.js";
import { skillList } from "./skill-list.js";
import { parseSearchQuery, searchSessions } from "./session-search.js";
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
  const brands = runtime.registry.listBrands();
  const first = routable.find((r) => r.active) ?? routable[0];
  const brand = first
    ? brands.find((b) => b.id === first.id)
    : undefined;
  return {
    ok: true,
    value: {
      version: runtime.version,
      cwd: runtime.workspaceRoot,
      ...(first ? { provider: first.id } : {}),
      ...(brand?.defaultModel ? { model: brand.defaultModel } : {}),
      attachedSessions: runtime.store.list().length,
      canOpenPath: canOpenNativePath(),
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
  const attach = runtime.workspaces.resolveAttachTarget({
    ...(typeof p.workspaceId === "string"
      ? { workspaceId: p.workspaceId.trim() }
      : {}),
    ...(typeof p.cwd === "string" ? { cwd: p.cwd.trim() } : {}),
  });
  if ("error" in attach) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: attach.error },
    };
  }
  const sessionId =
    typeof p.sessionId === "string" && p.sessionId.trim()
      ? runtime.ensureSession(p.sessionId.trim())
      : runtime.ensureSession();
  runtime.watchSession(sessionId);
  runtime.sessionCwds.set(sessionId, attach.cwd);
  const workspace = runtime.workspaces.attachSession(
    sessionId,
    attach.workspaceId,
  );
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
    cwd: attach.cwd,
    ...(bound ? { agentPreset: bound } : {}),
  });
  if (workspace) {
    runtime.bus.publishHost({
      type: "host/workspace-changed",
      workspace,
    });
  }
  return {
    ok: true,
    value: {
      sessionId,
      ...(bound ? { agentPreset: bound } : {}),
    },
  };
};

const sessionList: FaceHandler = async (runtime) => {
  const defaultCwd = path.resolve(runtime.workspaceRoot);
  const items = runtime.store.list().map((sessionId) => {
    const events = runtime.store.get(sessionId).events;
    const last = events[events.length - 1];
    const snap = runtime.projections.snapshot(sessionId);
    const meta = snap.values.sessionListMetadata;
    const blank =
      meta?.blank ?? !events.some((e) => e.type === "turn/start");
    const lastPromptAt = meta?.lastPromptAt ?? null;
    const updatedAt = Math.max(last?.ts ?? 0, lastPromptAt ?? 0);
    const cwd = runtime.sessionCwds.get(sessionId) ?? defaultCwd;
    const agentPreset = runtime.sessionAgentPresets.get(sessionId);
    return {
      sessionId,
      updatedAt,
      running: runtime.drain.isActive(sessionId),
      blank,
      cwd,
      ...(agentPreset ? { agentPreset } : {}),
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
  const inbox = runtime.inboxWire.fresh();
  const wireCtx = { sessionId, ids: runtime.wireIds, inbox };
  let indexed = events.map((event, i) =>
    toWireHistoryEntry(event, i + 1, wireCtx),
  );
  if (beforeSeq !== undefined) {
    indexed = indexed.filter((e) => e.event.seq < beforeSeq);
  }
  const hasMore = indexed.length > maxMessages;
  if (hasMore) {
    indexed = indexed.slice(-maxMessages);
  }
  // Align Face seq clock to at least max seen
  for (const row of indexed) {
    while (runtime.seq.last(sessionId) < row.event.seq) {
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

const sessionSearch: FaceHandler = async (runtime, _rpcId, payload) => {
  const parsed = parseSearchQuery(payload);
  if (!parsed.ok) return parsed;
  return { ok: true, value: searchSessions(runtime.store, parsed.value) };
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
  const admitId = `admit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  runtime.rpcAdmitMap.set(rpcId, admitId);
  runtime.admitRpcMap.set(admitId, rpcId);
  agent.admit(text, {
    delivery: mode === "steer" ? "steer" : "queue",
    admitId,
  });
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
  const selected = {
    provider,
    model,
    ...(typeof p.reasoningEffort === "string" && p.reasoningEffort.trim()
      ? { reasoningEffort: p.reasoningEffort.trim() }
      : {}),
  };
  runtime.sessionModels.set(sessionId, {
    provider: selected.provider,
    model: selected.model,
  });
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
    const { title, seq } = runtime.titles.rename(sessionId, titleRaw);
    return { ok: true, value: { title, seq } };
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
      const admitId = `admit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      if (rpc) {
        runtime.admitRpcMap.set(admitId, rpc);
        runtime.rpcAdmitMap.set(rpc, admitId);
      }
      admitPrompt(runtime.store, sessionId, target.content, {
        delivery: "steer",
        admitId,
      });
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
      const admitId = `admit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      if (rpc) {
        runtime.admitRpcMap.set(admitId, rpc);
        runtime.rpcAdmitMap.set(rpc, admitId);
      }
      admitPrompt(runtime.store, sessionId, text, {
        delivery: target.delivery,
        admitId,
      });
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

const agentPresetList: FaceHandler = async (runtime) => {
  const defaultId = runtime.defaultAgentPreset ?? "minimal";
  return {
    ok: true,
    value: {
      presets: FACE_AGENT_PRESETS.map((p) => ({
        id: p.id,
        trust: "system" as const,
        isDefault: p.id === defaultId,
        name: p.displayName,
        description: p.description,
      })),
      authorable: false,
      hasDocument: false,
    },
  };
};

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
  await runtime.invalidateAgent?.(sessionId);
  return { ok: true, value: { sessionId, agentPreset } };
};

const HANDLERS: Record<string, FaceHandler> = {
  "host.describe": hostDescribe,
  /**
   * No native OS chooser — cancel. Clients that need a path use
   * host.listDirectory / host.createDirectory (browse picker).
   */
  "host.pickDirectory": async () => ({ ok: true, value: { path: null } }),
  "host.listDirectory": async (_runtime, _rpcId, payload) =>
    hostListDirectory(payload),
  "host.createDirectory": async (_runtime, _rpcId, payload) =>
    hostCreateDirectory(payload),
  "host.openPath": async (_runtime, _rpcId, payload) => hostOpenPath(payload),
  "session.create": sessionCreate,
  "session.list": sessionList,
  "session.history": sessionHistory,
  "session.search": sessionSearch,
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
  /** DeepSeek Web workspace registry (not product-tree listProduct). */
  "workspace.list": async (runtime) => workspaceListDsh(runtime),
  "workspace.create": async (runtime, _rpcId, payload) =>
    workspaceCreateDsh(runtime, payload),
  "workspace.rename": async (runtime, _rpcId, payload) =>
    workspaceRenameDsh(runtime, payload),
  "workspace.archiveSession": async (runtime, _rpcId, payload) =>
    workspaceArchiveSessionDsh(runtime, payload),
  "workspace.previewInject": async (runtime, _rpcId, payload) =>
    workspacePreviewInject(runtime, payload),
  "workspace.syncSeeds": async (runtime, _rpcId, payload) =>
    workspaceSyncSeeds(runtime, payload),
  "settings.get": async (runtime, _rpcId, payload) =>
    settingsGet(runtime, payload),
  /** DeepSeek Web: namespaces[] (welcome notice, etc.). */
  "settings.describe": async (runtime) => settingsDescribeDsh(runtime),
  "settings.mutate": async (runtime, _rpcId, payload) =>
    settingsMutateDsh(runtime, payload),
  "settings.update": async (runtime, _rpcId, payload) =>
    settingsUpdateDsh(runtime, payload),
  "settings.replace": async (runtime, _rpcId, payload) =>
    settingsReplaceDsh(runtime, payload),
  "settings.set": async (runtime, _rpcId, payload) =>
    settingsSet(runtime, payload),
  /** No native settings document opener on headless Face. */
  "settings.openDocument": notImplemented,
  "credentials.list": async (runtime) => credentialsList(runtime),
  "credentials.describe": async (runtime, _rpcId, payload) =>
    credentialsDescribe(runtime, payload),
  "credentials.set": async (runtime, _rpcId, payload) =>
    credentialsSet(runtime, payload),
  "credentials.unset": async (runtime, _rpcId, payload) =>
    credentialsUnset(runtime, payload),
  // Skills from workspace .xrk/skills/<id>/SKILL.md (AGT-style).
  "skill.list": async (runtime, _rpcId, payload) =>
    skillList(runtime.workspaceRoot, payload),
  /** Empty child catalog until subagent Face is wired. */
  "subagent.list": async () => ({
    ok: true,
    value: { entries: [] as unknown[], parentAvailable: true },
  }),
  // explicit not-implemented
  "session.attachment": notImplemented,
  "llm.discoverModels": notImplemented,
  "workspace.delete": notImplemented,
  "workspace.insertBefore": notImplemented,
  "workspace.insertSessionBefore": notImplemented,
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
