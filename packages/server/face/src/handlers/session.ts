import {
  AdmitNotPendingError,
  listPendingAdmits,
  readSessionEvents,
  sessionEventCount,
  truncateSession,
  withdrawAdmit,
} from "@xrkseek/core-session";
import { forgetRequestHeaderCache } from "@xrkseek/core-agent-loop";
import {
  type AgentCancelCause,
  type MessageContent,
  type SessionEvent,
  flattenText,
  parseTurnEndCancelCause,
} from "@xrkseek/protocol";
import {
  FACE_AGENT_PRESET_IDS,
  canonicalAgentPresetId,
  resolveAgentPresetProfile,
} from "../presets-catalog.js";
import { isAgentTeamSpawnRole } from "../agent-team-roles.js";
import { appearanceLookWire } from "../agent-roster-store.js";
import { formatPeerCollabStopNotice } from "../session-thread-message.js";
import { sessionIdsOnThread } from "../session-thread-publish.js";
import {
  queueItemNotFoundMessage,
  sessionNotFoundMessage,
} from "../face-error-text.js";
import { dressingFromPresence } from "../presence-dressing.js";
import { toWireHistoryEntry, collectToolCallArgsForPage, routeFromRequestHeader } from "../adapt/index.js";
import { rewritePendingAdmit } from "../update-queue-rewrite.js";
import {
  DEFAULT_HISTORY_MAX_MESSAGES,
  dropSupersededStreamDeltas,
  paginateSessionHistory,
  trimHistoryPageToWireBudget,
} from "../adapt/history-paginate.js";
import { tryFaceSlashCommand } from "../slash.js";
import { commitPlanMode } from "../plan-mode.js";
import { SessionTitleInvalidError } from "../projections/index.js";
import { parseSearchQuery, searchSessions } from "../session-search.js";
import { IM_AGENT_PRESET_ID, IM_WORKSPACE_ID } from "../im-workspace.js";
import { ensureImWorkspace } from "../im-workspace-ensure.js";
import {
  QICHUANG_AGENT_PRESET_ID,
  XIANGYANG_WORKSPACE_ID,
  isOrchestrationWorkspaceId,
} from "../xiangyang-workspace.js";
import {
  durablePromptContent,
  hasPromptContent,
  sessionImageStartIndex,
  type PromptWirePart,
} from "../durable-prompt.js";
import { asRecord, type FaceHandler } from "./types.js";
import { killLiveSessionJobs } from "./job.js";
import { publishSessionAdded } from "./session-added.js";
import {
  createListWorkSlice,
  maybeYieldListWork,
  throwIfListCancelled,
} from "../list-work-slice.js";
import {
  defaultPermissionPreset,
  ensureOrchestrationFullAccess,
  pinInheritedPermission,
  pinInitialPermission,
} from "../permissions.js";
import { resolveDefaultAgentPreset } from "../settings-document.js";
import {
  effectiveSessionAgentPreset,
  pinSessionAgentPreset,
  unpinSessionAgentPreset,
} from "../session-agent-preset.js";
import {
  modelSelectionFromPrefix,
  prefixHasImageContent,
  resolveForkCut,
} from "../fork-cut.js";
import {
  buildFaceModelCatalog,
  pinInheritedSessionModel,
  resolveSessionModelSelection,
  routeServed,
} from "../model-catalog.js";
import { reserveModelSessionSlot } from "../model-session-cap.js";
import { liveRouteAllowsImageInput } from "../llm-resolve.js";
import { selectSessionModel } from "../select-session-model.js";
import {
  clearSessionModelSelection,
  sessionModelsPath,
} from "../session-model-store.js";
import { resolveXrkHome } from "@xrkseek/server-config";
import { persistWorkspaceDoc } from "../workspace-store.js";
import {
  resolveParentWorkspaceAttach,
  resolveSessionCwd,
  setSessionWorkingDirectory,
} from "../session-cwd.js";
import { canvasWorkspaceIdForSession } from "../canvas-tools.js";
import {
  historyPageIncludesProjections,
  SESSION_LIST_PROJECTION_KEYS,
  sessionHistoryTailProjectionKeys,
  snapshotWireBlock,
} from "../projections/snapshot-keys.js";
import { buildSessionStatusSnapshot } from "../session-status.js";
import { buildRolloutTraceState } from "../rollout-trace.js";
import type { FaceRuntime } from "../context.js";

/**
 * Bounded join for sessionCancel's drain teardown. The drain latch keeps its
 * entry past this budget and re-arms on the next wake, so this is purely a
 * UI/RPC responsiveness limit — never a "drop the queue" deadline.
 */
const SESSION_CANCEL_JOIN_MS = 3_000;

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
        error: { code: "session-not-found", message: sessionNotFoundMessage(parentSessionId) },
      };
    }
  }

  // Materialize ws_im only when something actually attaches to it.
  if (
    typeof p.workspaceId === "string" &&
    p.workspaceId.trim() === IM_WORKSPACE_ID
  ) {
    await ensureImWorkspace(runtime);
  }

  const inheritParent =
    parentSessionId && !p.workspaceId && !p.cwd
      ? resolveParentWorkspaceAttach(runtime, parentSessionId)
      : undefined;
  const attach = runtime.workspaces.resolveAttachTarget({
    ...(typeof p.workspaceId === "string"
      ? { workspaceId: p.workspaceId.trim() }
      : {}),
    ...(typeof p.cwd === "string"
      ? { cwd: p.cwd.trim() }
      : inheritParent
        ? inheritParent
        : {}),
  });
  if ("error" in attach) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: attach.error },
    };
  }
  const requestedId =
    typeof p.sessionId === "string" && p.sessionId.trim()
      ? p.sessionId.trim()
      : "";
  const inheritFromEarly =
    typeof p.inheritFrom === "string" ? p.inheritFrom.trim() : "";
  const routeSource =
    parentSessionId ||
    (inheritFromEarly && inheritFromEarly !== requestedId
      ? inheritFromEarly
      : "");
  // Explicit provider/model (subagent child route) wins over parent inherit
  // so the cap reserves the route the session will actually use.
  const pinProvider =
    typeof p.provider === "string" ? p.provider.trim() : "";
  const pinModel = typeof p.model === "string" ? p.model.trim() : "";
  const pinEffort =
    typeof p.reasoningEffort === "string" ? p.reasoningEffort.trim() : "";
  const predictedRoute =
    pinProvider && pinModel
      ? {
          provider: pinProvider,
          model: pinModel,
          ...(pinEffort ? { reasoningEffort: pinEffort } : {}),
        }
      : routeSource
        ? resolveSessionModelSelection(runtime, routeSource)
        : resolveSessionModelSelection(runtime, "");
  const reuseExisting = Boolean(requestedId && runtime.store.has(requestedId));
  const slot = reserveModelSessionSlot(runtime, predictedRoute, {
    ...(reuseExisting ? { excludeSessionId: requestedId } : {}),
  });
  if (!slot.ok) {
    return {
      ok: false,
      error: {
        code: "model-session-cap",
        message: slot.problem,
        details: { ...slot.details },
      },
    };
  }
  let sessionId: string;
  try {
    sessionId = requestedId
      ? runtime.ensureSession(requestedId)
      : runtime.ensureSession();
  } catch (err) {
    slot.release();
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  runtime.watchSession(sessionId);
  runtime.sessionCwds.set(
    sessionId,
    inheritParent
      ? resolveSessionCwd(runtime, parentSessionId)
      : attach.cwd,
  );
  void runtime.invalidateAgent?.(sessionId);
  const workspace =
    attach.workspaceId === undefined
      ? undefined
      : runtime.workspaces.attachSession(sessionId, attach.workspaceId);
  // 向阳空间 locks 奇创; IM locks im (Host admit also pins im).
  const attachWs = attach.workspaceId;
  if (attachWs === XIANGYANG_WORKSPACE_ID) {
    pinSessionAgentPreset(runtime, sessionId, QICHUANG_AGENT_PRESET_ID);
  } else if (attachWs === IM_WORKSPACE_ID) {
    pinSessionAgentPreset(runtime, sessionId, IM_AGENT_PRESET_ID);
  } else if (agentPreset) {
    pinSessionAgentPreset(
      runtime,
      sessionId,
      canonicalAgentPresetId(agentPreset),
    );
  } else {
    const parentPreset = parentSessionId
      ? runtime.sessionAgentPresets.get(parentSessionId)
      : undefined;
    pinSessionAgentPreset(
      runtime,
      sessionId,
      parentPreset ??
        canonicalAgentPresetId(resolveDefaultAgentPreset(runtime)),
    );
  }

  // New Session inherits the source's *effective* route (pin or default
  // resolution), so Status and the composer agree. In-memory only — not
  // `session-models.json`. Unknown source: leave the default chain. A
  // subagent parent below still wins as the nearer relation.
  const inheritFrom =
    typeof p.inheritFrom === "string" ? p.inheritFrom.trim() : "";
  if (inheritFrom && inheritFrom !== sessionId) {
    pinInheritedSessionModel(runtime, inheritFrom, sessionId);
  }

  if (parentSessionId) {
    // Freeze the parent's effective route. Resolution is total, so a parent
    // that never picked still pins what it was actually on.
    pinInheritedSessionModel(runtime, parentSessionId, sessionId);
    const label =
      typeof p.label === "string" && p.label.trim()
        ? p.label.trim()
        : "subagent";
    const memberId =
      typeof p.memberId === "string" ? p.memberId.trim() : "";
    const memberRosterWs =
      typeof p.workspaceId === "string" && p.workspaceId.trim()
        ? p.workspaceId.trim()
        : canvasWorkspaceIdForSession(runtime, parentSessionId);
    const member = memberId
      ? runtime.agentRoster.get(memberRosterWs, memberId)
      : undefined;
    runtime.subagents.attach({
      parentSessionId,
      childSessionId: sessionId,
      mode: p.mode === "one-shot" ? "one-shot" : "continuable",
      label: member?.name || label,
      ...(isAgentTeamSpawnRole(p.role)
        ? { role: p.role }
        : member?.role && member.role !== "default"
          ? { role: member.role }
          : {}),
      ...(member
        ? {
            memberId: member.id,
            inject: member.inject,
            appearance: appearanceLookWire(
              member.appearance,
              dressingFromPresence(
                runtime.settingsNamespaces.view("ui-presence").value as Record<string, unknown>,
              ).stickers,
            ),
            ...(member.tools ? { tools: member.tools } : {}),
          }
        : {}),
    });
    runtime.sessionThreads.unbind(
      canvasWorkspaceIdForSession(runtime, parentSessionId),
      sessionId,
    );
  }
  const bound =
    runtime.sessionAgentPresets.get(sessionId) ?? agentPreset;
  try {
    if (parentSessionId) {
      pinInheritedPermission(
        runtime.store,
        parentSessionId,
        sessionId,
        { autoGate: runtime.permissionAuto },
      );
      runtime.pathAllowlist.inherit(sessionId, parentSessionId);
      runtime.pathAllowlist.hydrate(runtime.store, parentSessionId);
    }
    runtime.pathAllowlist.hydrate(runtime.store, sessionId);
    // Settings permission.defaultPreset applies to coding workspaces only.
    // IM / 向阳空间: one locked permission (full access / path open).
    // Must run after inherit — pinInitialPermission no-ops when knobs exist.
    if (isOrchestrationWorkspaceId(attachWs)) {
      ensureOrchestrationFullAccess(runtime.store, sessionId, {
        autoGate: runtime.permissionAuto,
      });
    } else {
      pinInitialPermission(
        runtime.store,
        sessionId,
        defaultPermissionPreset(runtime),
        { autoGate: runtime.permissionAuto },
      );
    }
  } catch (err) {
    runtime.store.delete?.(sessionId);
    forgetRequestHeaderCache(sessionId);
    slot.release();
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  // Pin the reserved route when callers named it (or nothing inherited yet)
  // so Status / occupancy match the slot we held.
  if (pinProvider && pinModel) {
    runtime.sessionModels.set(sessionId, {
      provider: pinProvider,
      model: pinModel,
      ...(pinEffort ? { reasoningEffort: pinEffort } : {}),
    });
  } else if (!runtime.sessionModels.has(sessionId)) {
    runtime.sessionModels.set(sessionId, { ...predictedRoute });
  }
  const boundPreset =
    runtime.sessionAgentPresets.get(sessionId) ??
    canonicalAgentPresetId(resolveDefaultAgentPreset(runtime));
  if (
    !parentSessionId &&
    resolveAgentPresetProfile(boundPreset).planModeDefault
  ) {
    commitPlanMode(runtime.store, sessionId, true);
  }
  publishSessionAdded(runtime, sessionId);
  if (workspace) {
    runtime.bus.publishHost({
      type: "host/workspace-changed",
      workspace,
    });
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  // Live session now counts in occupancy — drop the pending credit.
  slot.release();
  return {
    ok: true,
    value: {
      sessionId,
      ...(bound ? { agentPreset: bound } : {}),
    },
  };
};

export const sessionList: FaceHandler = async (runtime) => {
  const slice = createListWorkSlice(
    runtime.listWorkSliceMs === undefined
      ? undefined
      : { sliceMs: runtime.listWorkSliceMs },
  );
  const sessionIds = runtime.store.list();
  const items: Array<Record<string, unknown>> = [];
  for (const sessionId of sessionIds) {
    throwIfListCancelled(slice.signal);
    const hints = runtime.store.listHints?.(sessionId);
    const loaded = runtime.store.isLoaded?.(sessionId) ?? true;
    const snap =
      hints !== undefined && !loaded
        ? runtime.listProjectionCache.cachedSnapshot(
            sessionId,
            runtime.projections,
          )
        : runtime.projections.snapshot(sessionId, {
            keys: [...SESSION_LIST_PROJECTION_KEYS],
          });
    const meta = snap?.values.sessionListMetadata;
    const blank =
      meta?.blank ??
      !(hints?.hasTurnStart === true || hints?.hasCommandRun === true);
    const lastPromptAt = meta?.lastPromptAt ?? null;
    const updatedAt = Math.max(hints?.lastEventTs ?? 0, lastPromptAt ?? 0);
    const cwd = resolveSessionCwd(runtime, sessionId);
    const wsId = runtime.workspaces.workspaceIdOf(sessionId);
    const wsRow = wsId ? runtime.workspaces.get(wsId) : undefined;
    const agentPreset = effectiveSessionAgentPreset(runtime, sessionId);
    const lineage = runtime.subagents.getByChild(sessionId);
    const forkParent = runtime.forkLineage.getByChild(sessionId);
    const workspaceKey = canvasWorkspaceIdForSession(runtime, sessionId);
    const bind = runtime.sessionThreads.bindOf(workspaceKey, sessionId);
    const thread = bind
      ? runtime.sessionThreads.get(workspaceKey, bind.threadId)
      : undefined;
    const sideline = bind?.sideline ?? runtime.presence.get(sessionId)?.tips;
    const parentOrigin =
      lineage && lineage.mode !== "fork"
        ? {
            parentSessionId: lineage.parentSessionId,
            origin: "subagent" as const,
          }
        : forkParent || (lineage && lineage.mode === "fork")
          ? {
              parentSessionId:
                forkParent?.parentSessionId ?? lineage!.parentSessionId,
              origin: "fork" as const,
            }
          : wsId === IM_WORKSPACE_ID
            ? { origin: "im" as const }
            : undefined;
    items.push({
      sessionId,
      updatedAt,
      running: runtime.drain.isActive(sessionId),
      blank,
      cwd,
      ...(wsId ? { workspaceId: wsId } : {}),
      ...(wsRow?.title ? { workspaceTitle: wsRow.title } : {}),
      agentPreset,
      ...(parentOrigin ?? {}),
      title: snap?.values.title ?? null,
      ...(thread ? { mainline: thread.title, mainlineId: thread.id } : {}),
      ...(sideline ? { sideline } : {}),
      ...(snap ? { projections: snapshotWireBlock(snap) } : {}),
    });
    await maybeYieldListWork(slice);
  }
  throwIfListCancelled(slice.signal);
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
  const events = readSessionEvents(runtime.store, sessionId);
  runtime.wireIds.primeFromLog(sessionId, events);
  // Resident eviction drops the in-memory allowlist; durable `path/allowlisted`
  // rows live in the log — refill before any tool path gate runs.
  runtime.pathAllowlist.hydrate(runtime.store, sessionId);

  const beforeSeq =
    typeof p.beforeSeq === "number" ? p.beforeSeq : undefined;
  const maxMessages =
    typeof p.maxMessages === "number"
      ? p.maxMessages
      : DEFAULT_HISTORY_MAX_MESSAGES;

  const raw = paginateSessionHistory(events, beforeSeq, maxMessages);
  // Absolute seq from the raw page index — drop/trim may remove rows, but must
  // not renumber survivors (client loadOlder requires tailSeq + 1 === baseSeq).
  const seqByEvent = new Map<SessionEvent, number>();
  for (let i = 0; i < raw.events.length; i++) {
    const event = raw.events[i];
    if (event !== undefined) seqByEvent.set(event, raw.startIndex + i + 1);
  }
  const stripped = dropSupersededStreamDeltas(raw.events);
  // Byte budget after delta drop — tool dumps can still blow past the wire
  // budget with few transcript messages; shrink from the older side.
  const fitted = trimHistoryPageToWireBudget(
    stripped,
    raw.startIndex,
    raw.hasMore,
  );
  const pageEvents = fitted.events;
  const pageStartSeq = pageEvents[0] !== undefined
    ? (seqByEvent.get(pageEvents[0]) ?? raw.startIndex + 1)
    : raw.startIndex + 1;
  const pageStartIndex = pageStartSeq - 1;
  const inbox = runtime.inboxWire.fresh();
  // Seed pending admits from the prefix so in-page prompt/promoted resolves to
  // agent/inbox/spliced (fresh projector otherwise drops the promote as ignorable
  // when prompt/admitted fell before this page's cut — loadOlder then lost the
  // claim and painted mid-turn 插话 as a plain opener).
  for (let i = 0; i < pageStartIndex; i++) {
    const prior = events[i];
    if (
      prior !== undefined
      && (prior.type === "prompt/admitted"
        || prior.type === "prompt/promoted"
        || prior.type === "prompt/withdrawn")
    ) {
      inbox.project(prior);
    }
  }
  const toolArgs = collectToolCallArgsForPage(events, pageEvents, seqByEvent);
  const wireCtxBase = {
    sessionId,
    ids: runtime.wireIds,
    inbox,
    toolArgs,
    ...(runtime.getTool
      ? { getTool: (name: string) => runtime.getTool!(sessionId, name) }
      : {}),
  };
  // Seed route from the last request/header before the page, then walk only
  // page events (same attribution as a full-log scan; O(page) not O(log)).
  let modelRoute = runtime.sessionModels.get(sessionId);
  for (let i = pageStartIndex - 1; i >= 0; i--) {
    const seeded = routeFromRequestHeader(events[i]!);
    if (seeded) {
      modelRoute = seeded;
      break;
    }
  }
  const indexed: ReturnType<typeof toWireHistoryEntry>[] = [];
  for (const event of pageEvents) {
    const fromHeader = routeFromRequestHeader(event);
    if (fromHeader) modelRoute = fromHeader;
    const seq = seqByEvent.get(event) ?? 0;
    indexed.push(
      toWireHistoryEntry(event, seq, {
        ...wireCtxBase,
        ...(modelRoute ? { modelRoute } : {}),
      }),
    );
  }
  const hasMore = fitted.hasMore;
  let maxWireSeq = 0;
  for (const row of indexed) {
    if (row.event.seq > maxWireSeq) maxWireSeq = row.event.seq;
  }
  if (maxWireSeq > 0) runtime.seq.ensureAtLeast(sessionId, maxWireSeq);

  let projections: ReturnType<typeof snapshotWireBlock> | undefined;
  if (historyPageIncludesProjections(beforeSeq)) {
    const snap = runtime.projections.snapshot(sessionId, {
      keys: [...sessionHistoryTailProjectionKeys()],
    });
    if (Object.keys(snap.values).length > 0) {
      projections = snapshotWireBlock(snap);
    }
    runtime.listProjectionCache.remember(
      sessionId,
      runtime.projections.checkpoint(sessionId),
    );
  }

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
        ...(typeof x.sourcePath === "string" && x.sourcePath.length > 0
          ? { sourcePath: x.sourcePath }
          : {}),
      });
      continue;
    }
    if (x.type === "file") {
      if (typeof x.data !== "string") {
        return {
          ok: false,
          error: {
            code: "invalid-payload",
            message: "file part requires data",
          },
        };
      }
      parts.push({
        type: "file",
        data: x.data,
        ...(typeof x.name === "string" ? { name: x.name } : {}),
        ...(typeof x.mediaType === "string" ? { mediaType: x.mediaType } : {}),
        ...(typeof x.sourcePath === "string" && x.sourcePath.length > 0
          ? { sourcePath: x.sourcePath }
          : {}),
      });
      continue;
    }
    return {
      ok: false,
      error: { code: "invalid-payload", message: "unknown content part" },
    };
  }

  if (!hasPromptContent(parts)) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "prompt must include non-whitespace text or an attachment",
      },
    };
  }

  const hasImage = parts.some((x) => x.type === "image");
  const hasFile = parts.some((x) => x.type === "file");
  const hasAttachment = hasImage || hasFile;
  if (hasAttachment && !runtime.attachments) {
    return {
      ok: false,
      error: {
        code: "attachment-unavailable",
        message: "attachment store not configured",
      },
    };
  }
  if (hasImage) {
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
  if (hasAttachment) {
    const startIndex = sessionImageStartIndex(
      readSessionEvents(runtime.store, sessionId),
    );
    const durable = await durablePromptContent(parts, runtime.attachments!, {
      imageStartIndex: startIndex,
    });
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
    admitContent = text;
  }

  runtime.watchSession(sessionId);

  if (mode === "queue") {
    const child = runtime.subagents.getByChild(sessionId);
    // Delegated children stay off the 主线; UI forks keep their inherited bind.
    if (child && child.mode !== "fork") {
      runtime.sessionThreads.unbind(
        canvasWorkspaceIdForSession(runtime, sessionId),
        sessionId,
      );
    }
  }

  const agent = await runtime.resolveAgent(sessionId);
  const admitId = `admit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const echoRpc =
    typeof p.requestId === "string" && p.requestId.length > 0 ? p.requestId : rpcId;
  runtime.rpcAdmitMap.set(rpcId, admitId);
  runtime.admitRpcMap.set(admitId, echoRpc);
  agent.admit(admitContent, {
    delivery: mode === "steer" ? "steer" : "queue",
    admitId,
  });
  // Echo rpcId is stamped on promote (admitRpcMap → pendingUserRpc FIFO), not
  // here: a prompt-time write raced with in-flight injects and stole the prior
  // admit's pending slot (stuck local echo / blue waiting chrome).
  runtime.publishQueue(sessionId);
  runtime.drain.wake(sessionId);

  return { ok: true, value: { accepted: true } };
};

/**
 * Resolve cancel cause from Face payload; bare Stop defaults to `user`.
 * Live `agent.abort` only accepts {@link AgentCancelCause} — `legacy` is a
 * durable turn/end fallback, so map it to `user` for the latch.
 */
function collabStopWhy(cause: AgentCancelCause): string {
  if (cause.kind === "user") return "stopped by the user";
  if (cause.kind === "parent") return "interrupted by the parent";
  if (cause.kind === "disposed") return "was disposed";
  return `stopped by a hook (${cause.reason})`;
}

/** Steer every other parent on the same 主线 when this session is cut off. */
function notifyThreadCollabStopped(
  runtime: FaceRuntime,
  sessionId: string,
  cause: AgentCancelCause,
): void {
  const workspaceId = runtime.workspaces.workspaceIdOf(sessionId);
  if (!workspaceId) return;
  const bind = runtime.sessionThreads.bindOf(workspaceId, sessionId);
  if (!bind) return;
  const peers = sessionIdsOnThread(runtime, workspaceId, bind.threadId)
    .filter((id) => id !== sessionId && !runtime.subagents.getByChild(id));
  if (peers.length === 0) return;
  const text = formatPeerCollabStopNotice({
    sessionId,
    why: collabStopWhy(cause),
  });
  for (const peerId of peers) {
    void runtime.resolveAgent(peerId).then((peer) => {
      peer.admit(text, { delivery: "steer" });
      runtime.drain.wake(peerId);
    }).catch(() => undefined);
  }
}

function cancelCauseFromPayload(payload: unknown): AgentCancelCause {
  const raw = asRecord(payload).cause;
  if (raw === undefined) return { kind: "user" };
  const cause = parseTurnEndCancelCause(raw);
  return cause.kind === "legacy" ? { kind: "user" } : cause;
}

export const sessionCancel: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = String(asRecord(payload).sessionId ?? "");
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const cause = cancelCauseFromPayload(payload);
  // 1) Optimistic running:false — published *before* the drain join so a
  //    stuck tool (git snapshot, hung LLM call) can never pin the UI to
  //    "running" forever. publishDrainIdle re-publishes false after the
  //    body finally settles, and any later wake re-arms running:true.
  runtime.bus.publishHost({
    type: "host/session-status",
    sessionId,
    running: false,
  });
  runtime.markTurnUiIdle(sessionId);
  // Abort the agent turn latch first so in-flight LLM/tool work sees the
  // cancellation immediately; then join the drain body (which shares the
  // same abort signal path via continueTurn).
  try {
    const agent = await runtime.resolveAgent(sessionId);
    agent.abort(cause);
  } catch {
    /* ignore */
  }
  // 2) Kill yielded / background shell jobs for this session. Turn abort
  //    alone leaves them alive (signal was only wired while the tool wait
  //    owned them), which resurfaces as Stop needing multiple clicks and
  //    floating "background job finished" toasts.
  killLiveSessionJobs(runtime.shell, sessionId);
  runtime.publishJobs(sessionId);
  const childLink = runtime.subagents.getByChild(sessionId);
  if (
    childLink?.mode === "continuable" &&
    (cause.kind === "user" || cause.kind === "parent")
  ) {
    runtime.notifyOwnedSubagentStopped(sessionId, cause.kind);
  } else if (!childLink) {
    notifyThreadCollabStopped(runtime, sessionId, cause);
  }
  // Delegated workers are independent sessions. Stopping, archiving, or
  // deleting this session must not abort them; they finish and reply on
  // their own (inline tool result, spill file, or a later user message).
  // 3) Bounded drain join in the background. Returning accepted here unblocks
  //    the client Stop click immediately; Host already published running:false
  //    and aborted the turn. The latch keeps its entry on timeout so a message
  //    admitted during teardown still drains once the stuck chain settles.
  void runtime.drain.cancel(sessionId, {
    cause,
    timeoutMs: SESSION_CANCEL_JOIN_MS,
  }).catch(() => undefined);
  return { ok: true, value: { accepted: true } };
};

/**
 * Permanently delete an archived session: cancel any drain, drop the durable
 * log, forget workspace archive/membership, clear per-session Face caches,
 * and publish `host/session-removed` so list surfaces converge.
 */
export const sessionDelete: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = String(asRecord(payload).sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }
  if (!runtime.workspaces.isArchived(sessionId)) {
    return {
      ok: false,
      error: {
        code: "session-not-archived",
        message: "only archived sessions can be deleted",
        details: { sessionId },
      },
    };
  }
  if (typeof runtime.store.delete !== "function") {
    return {
      ok: false,
      error: {
        code: "session-delete-unsupported",
        message: "session store does not support delete",
      },
    };
  }

  // Stop the turn before wiping the log so a racing drain cannot re-append.
  await sessionCancel(runtime, `delete-${sessionId}`, {
    sessionId,
    cascade: true,
  });

  try {
    await runtime.onSessionFinalize?.(sessionId);
  } catch {
    /* Host Phase1 is best-effort */
  }

  runtime.externalAgents.detach(sessionId);
  runtime.forkLineage.detach(sessionId);
  try {
    await runtime.invalidateAgent?.(sessionId);
  } catch {
    /* ignore */
  }

  // Permanent wipe: drops hot and/or cold archive rows. VACUUM when freelist
  // is large enough so sessions.db / sessions-archive.db can shrink soon.
  runtime.store.delete(sessionId);
  try {
    runtime.store.reclaimStorage?.();
  } catch {
    /* best-effort */
  }
  forgetRequestHeaderCache(sessionId);
  const sets = runtime.workspaces.forgetSession(sessionId);
  await persistWorkspaceDoc(runtime, runtime.workspaces);

  runtime.listProjectionCache.forget(sessionId);
  runtime.wireIds.clear(sessionId);
  runtime.inboxWire.clear(sessionId);
  runtime.toolDisclosure.forget(sessionId);
  runtime.pathAllowlist.forget(sessionId);
  runtime.sessionModels.delete(sessionId);
  try {
    clearSessionModelSelection(
      sessionModelsPath(runtime.productDir?.trim() || resolveXrkHome()),
      sessionId,
    );
  } catch {
    /* sidecar best-effort */
  }
  runtime.sessionCwds.delete(sessionId);
  runtime.sessionHasImage.delete(sessionId);
  runtime.sessionImageScanned.delete(sessionId);
  unpinSessionAgentPreset(runtime, sessionId);
  runtime.goals.forget(sessionId);
  runtime.agentTeams.removeNode(sessionId);

  runtime.bus.publishHost({
    type: "host/session-removed",
    sessionId,
  });
  runtime.bus.publishHost({
    type: "host/archived-sessions-changed",
    archivedSessionIds: sets.archivedSessionIds,
  });
  runtime.bus.publishHost({
    type: "host/pinned-sessions-changed",
    pinnedSessionIds: sets.pinnedSessionIds,
  });

  return { ok: true, value: { deleted: true as const } };
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
  return selectSessionModel(runtime, {
    sessionId: String(p.sessionId ?? ""),
    provider: String(p.provider ?? ""),
    model: String(p.model ?? ""),
    ...(typeof p.reasoningEffort === "string"
      ? { reasoningEffort: p.reasoningEffort }
      : {}),
  });
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
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }

  const atSeq =
    typeof p.atSeq === "number" && Number.isFinite(p.atSeq)
      ? Math.floor(p.atSeq)
      : undefined;
  const beforeSeq =
    typeof p.beforeSeq === "number" && Number.isFinite(p.beforeSeq)
      ? Math.floor(p.beforeSeq)
      : undefined;

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

  const linkModeRaw = typeof p.linkMode === "string" ? p.linkMode.trim() : "";
  const linkMode =
    linkModeRaw === "one-shot" || linkModeRaw === "continuable"
      ? linkModeRaw
      : "fork";

  const parentEvents = readSessionEvents(runtime.store, sessionId);
  const cut = resolveForkCut(parentEvents, {
    ...(atSeq !== undefined ? { atSeq } : {}),
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  });
  if (!cut.ok) {
    return {
      ok: false,
      error: { code: cut.code, message: cut.message },
    };
  }

  // Turn-cut forks (`atSeq`): seed from the prefix only — a selectModel made
  // after the cut must not leak into an exploratory branch.
  // Edit-resubmit forks (`beforeSeq`): prefer the parent's live composer
  // selection so a recovery switch (broken API key → another route) survives
  // into the child; fall back to the prefix when the parent never overrode.
  const parentLive = runtime.sessionModels.get(sessionId);
  const seedModelPreview =
    beforeSeq !== undefined
      ? (parentLive ??
        modelSelectionFromPrefix(parentEvents.slice(0, cut.cut)))
      : modelSelectionFromPrefix(parentEvents.slice(0, cut.cut));
  const forkRoute =
    seedModelPreview ?? resolveSessionModelSelection(runtime, sessionId);
  const forkSlot = reserveModelSessionSlot(runtime, forkRoute);
  if (!forkSlot.ok) {
    return {
      ok: false,
      error: {
        code: "model-session-cap",
        message: forkSlot.problem,
        details: { ...forkSlot.details },
      },
    };
  }

  let child: ReturnType<FaceRuntime["forkSession"]>;
  try {
    child = runtime.forkSession(sessionId, cut.cut, preferredChild);
  } catch (err) {
    forkSlot.release();
    return {
      ok: false,
      error: {
        code: "fork-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  const seed = readSessionEvents(runtime.store, child.id);
  const seedModel =
    beforeSeq !== undefined
      ? (parentLive ?? modelSelectionFromPrefix(seed))
      : modelSelectionFromPrefix(seed);
  if (seedModel) {
    runtime.sessionModels.set(child.id, { ...seedModel });
  } else {
    runtime.sessionModels.set(child.id, { ...forkRoute });
  }
  // Agent preset stays with the source composition so seeded tool calls remain
  // resolvable; durable knob events after the cut are already excluded.
  const parentPreset = runtime.sessionAgentPresets.get(sessionId);
  if (parentPreset) {
    pinSessionAgentPreset(runtime, child.id, parentPreset);
  } else {
    pinSessionAgentPreset(
      runtime,
      child.id,
      canonicalAgentPresetId(resolveDefaultAgentPreset(runtime)),
    );
  }

  runtime.watchSession(child.id);
  const parentCwd = resolveSessionCwd(runtime, sessionId);
  runtime.sessionCwds.set(child.id, parentCwd);
  // Seed may carry durable path grants; subagent children also inherit the
  // parent's live allowlist (same as session.create with parentSessionId).
  if (linkMode !== "fork") {
    runtime.pathAllowlist.inherit(child.id, sessionId);
    runtime.pathAllowlist.hydrate(runtime.store, sessionId);
  }
  runtime.pathAllowlist.hydrate(runtime.store, child.id);
  if (prefixHasImageContent(seed)) {
    runtime.sessionHasImage.add(child.id);
    runtime.sessionImageScanned.add(child.id);
  }
  const parentAttach = resolveParentWorkspaceAttach(runtime, sessionId);
  let parentWs: string | undefined;
  if ("workspaceId" in parentAttach) {
    parentWs = parentAttach.workspaceId;
  } else {
    const target = runtime.workspaces.resolveAttachTarget(parentAttach);
    if (!("error" in target)) parentWs = target.workspaceId;
  }
  // Fork seed may carry Auto — refuse without live Guardian (DSH pinInitial).
  // Orch workspaces stay locked full access after attach (ignore Settings).
  // The seed usually already carries the full-access identity, and
  // ensureOrchestrationFullAccess is a no-op then, so re-locking here cannot
  // append a second copy of the knobs into the child's log.
  try {
    if (isOrchestrationWorkspaceId(parentWs)) {
      ensureOrchestrationFullAccess(runtime.store, child.id, {
        autoGate: runtime.permissionAuto,
      });
    } else {
      pinInitialPermission(
        runtime.store,
        child.id,
        defaultPermissionPreset(runtime),
        { autoGate: runtime.permissionAuto },
      );
    }
  } catch (err) {
    runtime.store.delete?.(child.id);
    forgetRequestHeaderCache(child.id);
    forkSlot.release();
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  const workspace = parentWs
    ? runtime.workspaces.attachSession(child.id, parentWs)
    : undefined;
  const title = runtime.projections.snapshot(sessionId).values.title;
  if (linkMode === "fork") {
    // Exploratory UI fork: lineage only — never the subagent/delegation graph.
    runtime.forkLineage.attach({
      parentSessionId: sessionId,
      childSessionId: child.id,
    });
    const wsKey = canvasWorkspaceIdForSession(runtime, sessionId);
    const parentBind = runtime.sessionThreads.bindOf(wsKey, sessionId);
    if (parentBind) {
      runtime.sessionThreads.switchTo(wsKey, child.id, parentBind.threadId);
      if (parentBind.sideline) {
        runtime.sessionThreads.setSideline(
          wsKey,
          child.id,
          parentBind.sideline,
        );
      }
    }
  } else {
    runtime.subagents.attach({
      parentSessionId: sessionId,
      childSessionId: child.id,
      mode: linkMode,
      label:
        typeof p.label === "string" && p.label.trim()
          ? p.label.trim()
          : typeof title === "string" && title.trim()
            ? title.trim()
            : "subagent",
      ...(isAgentTeamSpawnRole(p.role) ? { role: p.role } : {}),
    });
  }
  publishSessionAdded(runtime, child.id);
  if (workspace) {
    runtime.bus.publishHost({
      type: "host/workspace-changed",
      workspace,
    });
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  forkSlot.release();
  return {
    ok: true,
    value: {
      sessionId: child.id,
      parentSessionId: sessionId,
      eventCount: sessionEventCount(runtime.store, child.id),
      ...(cut.atSeq !== undefined ? { atSeq: cut.atSeq } : {}),
      ...(cut.beforeSeq !== undefined ? { beforeSeq: cut.beforeSeq } : {}),
    },
  };
};

/**
 * Cursor-style in-place truncate: same sessionId, drop the tail after the cut.
 * Cancels a live turn first so an open turn/end cannot re-enter the log.
 */
export const sessionTruncate: FaceHandler = async (runtime, _rpcId, payload) => {
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
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }
  if (typeof runtime.store.replacePrefix !== "function") {
    return {
      ok: false,
      error: {
        code: "truncate-unsupported",
        message: "session store does not support replacePrefix",
      },
    };
  }

  const atSeq =
    typeof p.atSeq === "number" && Number.isFinite(p.atSeq)
      ? Math.floor(p.atSeq)
      : undefined;
  const beforeSeq =
    typeof p.beforeSeq === "number" && Number.isFinite(p.beforeSeq)
      ? Math.floor(p.beforeSeq)
      : undefined;

  if (runtime.drain.isActive(sessionId)) {
    await runtime.drain.cancel(sessionId);
  }

  const parentEvents = readSessionEvents(runtime.store, sessionId);
  const cut = resolveForkCut(parentEvents, {
    ...(atSeq !== undefined ? { atSeq } : {}),
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  });
  if (!cut.ok) {
    return {
      ok: false,
      error: { code: cut.code, message: cut.message },
    };
  }

  try {
    truncateSession(runtime.store, sessionId, cut.cut);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "truncate-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const n = sessionEventCount(runtime.store, sessionId);
  runtime.seq.ensureAtLeast(sessionId, n);
  // Edit-resubmit cuts the log in place; wire turn numbers must follow the
  // kept prefix (or restart at 1). Leaving the pre-cut map marks the next
  // turnId as 第 2 轮 even when the first opener was removed.
  runtime.wireIds.clear(sessionId);
  runtime.wireIds.primeFromLog(
    sessionId,
    readSessionEvents(runtime.store, sessionId),
  );
  runtime.inboxWire.clear(sessionId);
  // Expanded MCP schemas are not in the log. Leaving them keeps the next
  // resubmit over the soft budget after the conversation itself was cut.
  runtime.toolDisclosure.forget(sessionId);
  runtime.pathAllowlist.forget(sessionId);
  runtime.pathAllowlist.hydrate(runtime.store, sessionId);
  void runtime.projections.snapshot(sessionId);
  forgetRequestHeaderCache(sessionId);

  return {
    ok: true,
    value: {
      sessionId,
      eventCount: n,
      ...(cut.atSeq !== undefined ? { atSeq: cut.atSeq } : {}),
      ...(cut.beforeSeq !== undefined ? { beforeSeq: cut.beforeSeq } : {}),
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
  if (
    decisionRaw !== "allow" &&
    decisionRaw !== "deny" &&
    decisionRaw !== "whitelist"
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: 'decision must be "allow" | "deny" | "whitelist"',
      },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
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

/**
 * `session.setWorkingDirectory` — read (`cd` omitted) or change session cwd.
 * Payload: `{ sessionId, cd? }`. Relative `cd` resolves against the current cwd.
 */
export const sessionSetWorkingDirectory: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }
  const cdRaw = p.cd;
  if (cdRaw === undefined || cdRaw === null || cdRaw === "") {
    return {
      ok: true,
      value: { cwd: resolveSessionCwd(runtime, sessionId) },
    };
  }
  if (typeof cdRaw !== "string") {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "cd must be a string" },
    };
  }
  const result = await setSessionWorkingDirectory(runtime, sessionId, cdRaw);
  if (!result.ok) {
    return {
      ok: false,
      error: { code: "cwd-invalid", message: result.error },
    };
  }
  return {
    ok: true,
    value: { cwd: result.cwd, changed: result.changed },
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
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
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

  // Subagent-owned sessions: only continuable children expose queue mutation.
  // One-shot stays read-only; do not cold-resume an agent to satisfy the call.
  const subLink = runtime.subagents.getByChild(sessionId);
  if (subLink?.mode === "one-shot") {
    return {
      ok: false,
      error: {
        code: "subagent-not-resumable",
        message: `Session ${sessionId} is a one-shot subagent and cannot take queue edits.`,
        details: {
          parentSessionId: subLink.parentSessionId,
          childSessionId: sessionId,
        },
      },
    };
  }

  const kind = Reflect.get(action, "kind");
  const pending = listPendingAdmits(
    readSessionEvents(runtime.store, sessionId),
    sessionId,
  );
  const target = pending.find((a) => a.admitId === itemId);
  if (!target) {
    return {
      ok: false,
      error: { code: "queue-item-not-found", message: queueItemNotFoundMessage(itemId) },
    };
  }

  const maps = {
    admitRpcMap: runtime.admitRpcMap,
    rpcAdmitMap: runtime.rpcAdmitMap,
  };

  try {
    if (kind === "remove") {
      withdrawAdmit(runtime.store, sessionId, itemId);
      runtime.admitRpcMap.delete(itemId);
    } else if (kind === "steer") {
      if (!runtime.drain.isActive(sessionId)) {
        return {
          ok: false,
          error: {
            code: "steer-unavailable",
            message: "agent is not running",
          },
        };
      }
      rewritePendingAdmit(
        runtime.store,
        sessionId,
        itemId,
        target.content,
        "steer",
        maps,
      );
      runtime.drain.wake(sessionId);
    } else if (kind === "edit") {
      const content = (action as { content?: unknown }).content;
      if (!Array.isArray(content) || content.length === 0) {
        return {
          ok: false,
          error: { code: "invalid-payload", message: "edit.content required" },
        };
      }
      const parts = content as readonly Record<string, unknown>[];
      const needsDurable = parts.some(
        (p) =>
          (p.type === "image" || p.type === "file") &&
          typeof p.data === "string",
      );
      let nextContent: MessageContent;
      if (needsDurable) {
        if (!runtime.attachments) {
          return {
            ok: false,
            error: {
              code: "attachment-unavailable",
              message: "attachment store not configured",
            },
          };
        }
        const startIndex = sessionImageStartIndex(
          readSessionEvents(runtime.store, sessionId),
        );
        const durable = await durablePromptContent(
          parts as PromptWirePart[],
          runtime.attachments,
          { imageStartIndex: startIndex },
        );
        if (!durable.ok) {
          return {
            ok: false,
            error: { code: durable.code, message: durable.message },
          };
        }
        nextContent = durable.content;
      } else {
        // Durable ContentBlock[] (keep existing image/file refs) or text-only.
        const blocks = parts.filter((p) => typeof p.type === "string");
        const onlyText = blocks.every((p) => p.type === "text");
        if (onlyText) {
          const text = blocks
            .map((p) => (typeof p.text === "string" ? p.text : ""))
            .join("");
          if (!text.trim()) {
            return {
              ok: false,
              error: { code: "invalid-payload", message: "edit text empty" },
            };
          }
          nextContent = text;
        } else {
          nextContent = blocks as unknown as MessageContent;
          const flat = flattenText(nextContent);
          const hasAtt = blocks.some(
            (p) => p.type === "image" || p.type === "file",
          );
          if (!flat.trim() && !hasAtt) {
            return {
              ok: false,
              error: { code: "invalid-payload", message: "edit content empty" },
            };
          }
        }
      }
      rewritePendingAdmit(
        runtime.store,
        sessionId,
        itemId,
        nextContent,
        target.delivery,
        maps,
      );
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

/** Shared Status snapshot (`/status` · Overview Status tab). */
export { sessionTools } from "../session-tools.js";

export const sessionStatus: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }
  return {
    ok: true,
    value: buildSessionStatusSnapshot(runtime, sessionId),
  };
};

/**
 * Local offline rollout-trace graph (spawn / message / tool edges).
 * Debug-only — not OTLP, not upload. Same reducer as export `trace/state.json`.
 */
export const sessionRolloutTrace: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }
  const includeDescendants = p.includeDescendants !== false;
  const ids = includeDescendants
    ? [sessionId, ...collectRolloutDescendants(runtime, sessionId)]
    : [sessionId];
  const eventsBySession: Record<string, ReturnType<typeof readSessionEvents>> =
    {};
  for (const id of ids) {
    if (!runtime.store.has(id)) continue;
    eventsBySession[id] = readSessionEvents(runtime.store, id);
  }
  const links = includeDescendants
    ? ids.flatMap((id) => [...runtime.subagents.list(id)])
    : [...runtime.subagents.list(sessionId)];
  return {
    ok: true,
    value: buildRolloutTraceState({
      rootSessionId: sessionId,
      eventsBySession,
      links: links.map((link) => ({
        parentSessionId: link.parentSessionId,
        childSessionId: link.childSessionId,
        mode: link.mode,
        label: link.label,
      })),
    }),
  };
};

function collectRolloutDescendants(
  runtime: FaceRuntime,
  rootId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const link of runtime.subagents.list(id)) {
      if (seen.has(link.childSessionId)) continue;
      seen.add(link.childSessionId);
      out.push(link.childSessionId);
      queue.push(link.childSessionId);
    }
  }
  return out;
}
