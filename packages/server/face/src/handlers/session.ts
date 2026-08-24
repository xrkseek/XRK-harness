import {
  AdmitNotPendingError,
  admitPrompt,
  listPendingAdmits,
  withdrawAdmit,
} from "@xrkseek/core-session";
import { assertPolicyAllow } from "@xrkseek/policy";
import { contentHasImage, type MessageContent, type SessionEvent } from "@xrkseek/protocol";
import { type FaceRuntime } from "../context.js";
import {
  FACE_AGENT_PRESET_IDS,
  canonicalAgentPresetId,
} from "../presets-catalog.js";
import { toWireHistoryEntry, collectToolCallArgs } from "../adapt/index.js";
import {
  DEFAULT_HISTORY_MAX_MESSAGES,
  paginateSessionHistoryForReplay,
} from "../adapt/history-paginate.js";
import { tryFaceSlashCommand } from "../slash.js";
import { SessionTitleInvalidError } from "../projections/index.js";
import { parseSearchQuery, searchSessions } from "../session-search.js";
import { durablePromptContent, type PromptWirePart } from "../durable-prompt.js";
import { asRecord, type FaceHandler } from "./types.js";
import { publishSessionAdded } from "./session-added.js";
import {
  defaultPermissionPreset,
  pinInitialPermission,
} from "../permissions.js";
import { resolveDefaultAgentPreset } from "../settings-document.js";
import {
  buildFaceModelCatalog,
  resolveSessionModelSelection,
  routeServed,
  saveAgentDefaultModel,
  type FaceModelSelection,
} from "../model-catalog.js";
import {
  liveRouteAllowsImageInput,
  resolveLlmForSelection,
} from "../llm-resolve.js";
import { publishRemoteEvent } from "../remote-event.js";
import { persistWorkspaceDoc } from "../workspace-store.js";
import { resolveSessionCwd } from "../session-cwd.js";

function sessionHasImageContent(runtime: FaceRuntime, sessionId: string): boolean {
  for (const ev of runtime.store.get(sessionId).events) {
    if (ev.type !== "user/message" && ev.type !== "prompt/admitted") continue;
    const content = (ev as { content?: MessageContent }).content;
    if (content !== undefined && contentHasImage(content)) return true;
  }
  return false;
}

export const sessionCreate: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const agentPreset =
    typeof p.agentPreset === "string" ? p.agentPreset : undefined;
  if (agentPreset && !FACE_AGENT_PRESET_IDS.has(agentPreset)) {
    return {
      ok: false,
      error: {
        code: "agent-preset-not-found",
        message: `unknown agentPreset: ${agentPreset}`,
      },
    };
  }
  const parentSessionId =
    typeof p.parentSessionId === "string" ? p.parentSessionId.trim() : "";
  if (parentSessionId) {
    if (!runtime.store.has(parentSessionId)) {
      return {
        ok: false,
        error: { code: "session-not-found", message: parentSessionId },
      };
    }
  }

  const inheritCwd =
    parentSessionId && !p.workspaceId && !p.cwd
      ? runtime.sessionCwds.get(parentSessionId)
      : undefined;
  const attach = runtime.workspaces.resolveAttachTarget({
    ...(typeof p.workspaceId === "string"
      ? { workspaceId: p.workspaceId.trim() }
      : {}),
    ...(typeof p.cwd === "string"
      ? { cwd: p.cwd.trim() }
      : inheritCwd
        ? { cwd: inheritCwd }
        : {}),
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
  const workspace =
    attach.workspaceId === undefined
      ? undefined
      : runtime.workspaces.attachSession(sessionId, attach.workspaceId);
  if (agentPreset) {
    runtime.sessionAgentPresets.set(
      sessionId,
      canonicalAgentPresetId(agentPreset),
    );
  } else {
    const parentPreset = parentSessionId
      ? runtime.sessionAgentPresets.get(parentSessionId)
      : undefined;
    runtime.sessionAgentPresets.set(
      sessionId,
      parentPreset ??
        canonicalAgentPresetId(resolveDefaultAgentPreset(runtime)),
    );
  }

  if (parentSessionId) {
    const parentModel = runtime.sessionModels.get(parentSessionId);
    if (parentModel) {
      runtime.sessionModels.set(sessionId, { ...parentModel });
    }
    const label =
      typeof p.label === "string" && p.label.trim()
        ? p.label.trim()
        : "subagent";
    runtime.subagents.attach({
      parentSessionId,
      childSessionId: sessionId,
      mode: p.mode === "one-shot" ? "one-shot" : "continuable",
      label,
    });
  }
  const bound =
    runtime.sessionAgentPresets.get(sessionId) ?? agentPreset;
  pinInitialPermission(
    runtime.store,
    sessionId,
    defaultPermissionPreset(runtime),
  );
  publishSessionAdded(runtime, sessionId);
  if (workspace) {
    runtime.bus.publishHost({
      type: "host/workspace-changed",
      workspace,
    });
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  return {
    ok: true,
    value: {
      sessionId,
      ...(bound ? { agentPreset: bound } : {}),
    },
  };
};

export const sessionList: FaceHandler = async (runtime) => {
  const items = runtime.store.list().map((sessionId) => {
    const events = runtime.store.get(sessionId).events;
    const last = events[events.length - 1];
    const snap = runtime.projections.snapshot(sessionId);
    const meta = snap.values.sessionListMetadata;
    const blank =
      meta?.blank ?? !events.some((e) => e.type === "turn/start");
    const lastPromptAt = meta?.lastPromptAt ?? null;
    const updatedAt = Math.max(last?.ts ?? 0, lastPromptAt ?? 0);
    const cwd = resolveSessionCwd(runtime, sessionId);
    const agentPreset = runtime.sessionAgentPresets.get(sessionId);
    const lineage = runtime.subagents.getByChild(sessionId);
    return {
      sessionId,
      updatedAt,
      running: runtime.drain.isActive(sessionId),
      blank,
      cwd,
      ...(agentPreset ? { agentPreset } : {}),
      ...(lineage
        ? {
            parentSessionId: lineage.parentSessionId,
            origin: "subagent" as const,
          }
        : {}),
      title: snap.values.title ?? null,
      projections: {
        asOfSeq: snap.asOfSeq,
        values: snap.values,
      },
    };
  });
  return { ok: true, value: { items } };
};

export const sessionHistory: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const events = runtime.store.get(sessionId).events;
  const seqByEvent = new Map<SessionEvent, number>();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event !== undefined) seqByEvent.set(event, i + 1);
  }

  const beforeSeq =
    typeof p.beforeSeq === "number" ? p.beforeSeq : undefined;
  const maxMessages =
    typeof p.maxMessages === "number"
      ? p.maxMessages
      : DEFAULT_HISTORY_MAX_MESSAGES;

  const page = paginateSessionHistoryForReplay(events, beforeSeq, maxMessages);
  const inbox = runtime.inboxWire.fresh();
  const toolArgs = collectToolCallArgs(events);
  const wireCtx = {
    sessionId,
    ids: runtime.wireIds,
    inbox,
    toolArgs,
    ...(runtime.getTool
      ? { getTool: (name: string) => runtime.getTool!(sessionId, name) }
      : {}),
  };
  const indexed = page.events.map((event) => {
    const seq = seqByEvent.get(event) ?? 0;
    return toWireHistoryEntry(event, seq, wireCtx);
  });
  const hasMore = page.hasMore;
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

export const sessionSearch: FaceHandler = async (runtime, _rpcId, payload) => {
  const parsed = parseSearchQuery(payload);
  if (!parsed.ok) return parsed;
  return { ok: true, value: searchSessions(runtime.store, parsed.value) };
};

export const sessionPrompt: FaceHandler = async (runtime, rpcId, payload) => {
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

  const parts: PromptWirePart[] = [];
  for (const raw of content) {
    const x = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (x.type === "text" && typeof x.text === "string") {
      parts.push({ type: "text", text: x.text });
      continue;
    }
    if (x.type === "image") {
      if (typeof x.mediaType !== "string" || typeof x.data !== "string") {
        return {
          ok: false,
          error: {
            code: "invalid-payload",
            message: "image part requires mediaType + data",
          },
        };
      }
      parts.push({
        type: "image",
        mediaType: x.mediaType,
        data: x.data,
        ...(typeof x.name === "string" ? { name: x.name } : {}),
      });
      continue;
    }
    return {
      ok: false,
      error: { code: "invalid-payload", message: "unknown content part" },
    };
  }

  const hasImage = parts.some((x) => x.type === "image");
  if (hasImage) {
    if (!runtime.attachments) {
      return {
        ok: false,
        error: {
          code: "attachment-unavailable",
          message: "attachment store not configured",
        },
      };
    }
    // Face intake max (Host may allow paste) AND live adapter route (Registry).
    const faceIntake = runtime.inputModalities ?? ["text"];
    if (!faceIntake.includes("image")) {
      return {
        ok: false,
        error: {
          code: "unsupported-modality",
          message: "active route does not accept image input",
        },
      };
    }
    if (!liveRouteAllowsImageInput(runtime, sessionId)) {
      return {
        ok: false,
        error: {
          code: "unsupported-modality",
          message: "active route does not accept image input",
        },
      };
    }
  }

  let admitContent;
  if (hasImage) {
    const durable = await durablePromptContent(parts, runtime.attachments!);
    if (!durable.ok) {
      return {
        ok: false,
        error: { code: durable.code, message: durable.message },
      };
    }
    admitContent = durable.content;
  } else {
    const text = parts
      .filter((x): x is Extract<PromptWirePart, { type: "text" }> => x.type === "text")
      .map((x) => x.text)
      .join("");
    if (parts.length === 1 && parts[0]?.type === "text" && text.startsWith("/")) {
      runtime.watchSession(sessionId);
      const slash = await tryFaceSlashCommand(runtime, sessionId, text);
      if (slash) return slash;
    }
    if (!text) {
      return {
        ok: false,
        error: { code: "invalid-payload", message: "empty text" },
      };
    }
    admitContent = text;
  }

  runtime.watchSession(sessionId);
  const agent = await runtime.resolveAgent(sessionId);
  const admitId = `admit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  runtime.rpcAdmitMap.set(rpcId, admitId);
  runtime.admitRpcMap.set(admitId, rpcId);
  agent.admit(admitContent, {
    delivery: mode === "steer" ? "steer" : "queue",
    admitId,
  });
  runtime.pendingUserRpc.set(sessionId, rpcId);
  runtime.publishQueue(sessionId);
  runtime.drain.wake(sessionId);

  return { ok: true, value: { accepted: true } };
};

export const sessionCancel: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = String(asRecord(payload).sessionId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  // Abort the agent turn latch first so in-flight LLM/tool work sees the
  // cancellation immediately; then join the drain body (which shares the
  // same abort signal path via continueTurn).
  try {
    const agent = await runtime.resolveAgent(sessionId);
    agent.abort({ kind: "user" });
  } catch {
    /* ignore */
  }
  await runtime.drain.cancel(sessionId);
  runtime.bus.publishHost({
    type: "host/session-status",
    sessionId,
    running: false,
  });
  return { ok: true, value: { accepted: true } };
};

export const sessionModels: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = String(asRecord(payload).sessionId ?? "");
  const current = resolveSessionModelSelection(runtime, sessionId);
  const { groups, failures } = buildFaceModelCatalog(runtime);
  const routable = routeServed(runtime, current.provider);
  return {
    ok: true,
    value: {
      current,
      routable,
      groups,
      failures,
    },
  };
};

export const sessionSelectModel: FaceHandler = async (runtime, _rpcId, payload) => {
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
    ...(typeof p.reasoningEffort === "string" && p.reasoningEffort.trim()
      ? { reasoningEffort: p.reasoningEffort.trim() }
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
};

export const sessionFork: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
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
  if (preferredChild && runtime.store.has(preferredChild)) {
    return {
      ok: false,
      error: {
        code: "session-exists",
        message: preferredChild,
      },
    };
  }

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
  const parentCwd = runtime.sessionCwds.get(sessionId);
  if (parentCwd) runtime.sessionCwds.set(child.id, parentCwd);
  const parentWs =
    runtime.workspaces.workspaceIdOf(sessionId) ??
    runtime.workspaces.defaultId();
  const workspace = runtime.workspaces.attachSession(child.id, parentWs);
  const title = runtime.projections.snapshot(sessionId).values.title;
  runtime.subagents.attach({
    parentSessionId: sessionId,
    childSessionId: child.id,
    mode: "continuable",
    label: typeof title === "string" && title.trim() ? title.trim() : "fork",
  });
  publishSessionAdded(runtime, child.id);
  if (workspace) {
    runtime.bus.publishHost({
      type: "host/workspace-changed",
      workspace,
    });
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);
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

export const sessionRespondApproval: FaceHandler = async (runtime, _rpcId, payload) => {
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
  if (!runtime.store.has(sessionId)) {
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

export const sessionRename: FaceHandler = async (runtime, _rpcId, payload) => {
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
  if (!runtime.store.has(sessionId)) {
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

export const sessionUpdateQueue: FaceHandler = async (runtime, _rpcId, payload) => {
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
