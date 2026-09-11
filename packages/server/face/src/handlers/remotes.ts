import {
  executeFaceCommand,
  listFaceCommandDescriptors,
} from "../slash.js";
import {
  listFacePluginInventory,
  resolveManagedPluginDir,
  resolveManagedPluginUpdateSpec,
  resolveManagedPluginsDir,
  setFacePluginInventoryEnabled,
  clearSoftDisabledIdsAt,
  lookupManagedPluginSourceAt,
  reconcileManagedClientBoot,
} from "../plugin-inventory.js";
import { openNativePath } from "../host-open-path.js";
import { buildFaceChannelDiscover, resolveImGatewayWired } from "../process-channels.js";
import { sessionFeedbackRecord } from "../session-feedback.js";
import { remoteArgs, type FaceHandler } from "./types.js";

function sessionFromAgentId(
  runtime: Parameters<FaceHandler>[0],
  agentId: string,
): { ok: true } | { ok: false; error: { code: string; message: string } } {
  if (!agentId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "agentId required" },
    };
  }
  if (!runtime.store.has(agentId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: agentId },
    };
  }
  return { ok: true };
}

/** DSH `POST /api/commands/list` — `{ args: { agentId } }`. */
export const commandsList: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const agentId = String(args.agentId ?? "");
  const session = sessionFromAgentId(runtime, agentId);
  if (!session.ok) return session;
  const commands = await listFaceCommandDescriptors(
    runtime.loadSlashRecipes,
    runtime.plugins,
  );
  return { ok: true, value: commands };
};

/** DSH `POST /api/commands/execute` — `{ args: { agentId, line } }`. */
export const commandsExecute: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const agentId = String(args.agentId ?? "");
  const line = String(args.line ?? "");
  const session = sessionFromAgentId(runtime, agentId);
  if (!session.ok) return session;
  const execution = await executeFaceCommand(runtime, agentId, line);
  return { ok: true, value: execution };
};

/** DSH `pluginInventory/list` — process plugins + product-shell boot entries. */
export const pluginInventoryList: FaceHandler = async (runtime) => ({
  ok: true,
  value: { entries: listFacePluginInventory(runtime) },
});

/** Soft-disable / re-enable a managed (user) plugin in the inventory UI. */
export const pluginInventorySetEnabled: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const entryId = String(args.entryId ?? "").trim();
  const enabled = args.enabled === true;
  if (!entryId) {
    return { ok: false, error: { code: "invalid-payload", message: "entryId required" } };
  }
  const result = setFacePluginInventoryEnabled(runtime, entryId, enabled);
  if (!result.ok) {
    return { ok: false, error: { code: "refused", message: result.error } };
  }
  // Process half applies in-process; client half still needs a page reload.
  await runtime.syncManagedProcessPlugins?.();
  return { ok: true, value: { entryId, enabled } };
};

/** Remove a managed user plugin via Host CLI mutate when wired. */
export const pluginInventoryRemove: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const entryId = String(args.entryId ?? "").trim();
  if (!entryId) {
    return { ok: false, error: { code: "invalid-payload", message: "entryId required" } };
  }
  const entry = listFacePluginInventory(runtime).find((e) => e.entryId === entryId);
  if (!entry) {
    return { ok: false, error: { code: "not-found", message: entryId } };
  }
  if (!entry.managed) {
    return {
      ok: false,
      error: { code: "refused", message: "builtin plugins cannot be removed here" },
    };
  }
  if (!runtime.removeUserPlugin) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: `Use: xrk-harness plugin remove ${entryId}`,
      },
    };
  }
  const result = await runtime.removeUserPlugin(entryId);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "failed",
        message: result.error ?? `plugin remove failed for ${entryId}`,
      },
    };
  }
  // Refresh boot overlay; orphan soft-disable markers are pruned here too.
  reconcileManagedClientBoot(runtime);
  await runtime.syncManagedProcessPlugins?.();
  return { ok: true, value: { entryId, removed: true as const } };
};

/** Reinstall / bump a managed plugin from its inventory source (or name@latest). */
export const pluginInventoryUpdate: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const entryId = String(args.entryId ?? "").trim();
  if (!entryId) {
    return { ok: false, error: { code: "invalid-payload", message: "entryId required" } };
  }
  const entry = listFacePluginInventory(runtime).find((e) => e.entryId === entryId);
  if (!entry) {
    return { ok: false, error: { code: "not-found", message: entryId } };
  }
  if (!entry.managed) {
    return {
      ok: false,
      error: { code: "refused", message: "builtin plugins cannot be updated here" },
    };
  }
  if (!runtime.updateUserPlugin) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: `Use: xrkh plugin add ${entryId}@latest`,
      },
    };
  }
  const pluginsDir = resolveManagedPluginsDir(runtime);
  const source = lookupManagedPluginSourceAt(
    pluginsDir,
    entryId,
    entry.moduleName,
  );
  const spec = resolveManagedPluginUpdateSpec(entryId, source);
  const result = await runtime.updateUserPlugin(spec);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "failed",
        message: result.error ?? `plugin update failed for ${entryId}`,
      },
    };
  }
  // Re-enable after a successful update so the new build is bootable
  // (clear entryId + moduleName aliases via shared soft-disable helper).
  clearSoftDisabledIdsAt(
    pluginsDir,
    entryId,
    entry.moduleName,
  );
  reconcileManagedClientBoot(runtime);
  await runtime.syncManagedProcessPlugins?.();
  return { ok: true, value: { entryId, updated: true as const } };
};

/** Open the on-disk install folder for a managed plugin (Settings “edit”). */
export const pluginInventoryOpen: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const entryId = String(args.entryId ?? "").trim();
  if (!entryId) {
    return { ok: false, error: { code: "invalid-payload", message: "entryId required" } };
  }
  const entry = listFacePluginInventory(runtime).find((e) => e.entryId === entryId);
  if (!entry) {
    return { ok: false, error: { code: "not-found", message: entryId } };
  }
  if (!entry.managed) {
    return {
      ok: false,
      error: { code: "refused", message: "builtin plugins cannot be edited here" },
    };
  }
  const dir = resolveManagedPluginDir(runtime, entry.entryId, entry.moduleName);
  if (!dir) {
    return {
      ok: false,
      error: {
        code: "not-found",
        message: `plugin folder not found for ${entryId}`,
      },
    };
  }
  if (runtime.openNativePath) {
    await runtime.openNativePath(dir);
  } else {
    await openNativePath(dir);
  }
  return { ok: true, value: { entryId, opened: true as const } };
};

/** DSH `processChannels/list` — plugin channel contributions + IM vendor stubs. */
export const processChannelsList: FaceHandler = async (runtime) => ({
  ok: true,
  value: buildFaceChannelDiscover(runtime.plugins, {
    imGatewayWired: resolveImGatewayWired(),
  }),
});

/** DSH Typert `messageFeedback/list` — nested `{ ok, value|error }`. */
export const messageFeedbackList: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  return runtime.messageFeedback.list(
    runtime.store,
    String(args.sessionId ?? ""),
  );
};

/** DSH Typert `messageFeedback/put` — create/replace with CAS. */
export const messageFeedbackPut: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  return runtime.messageFeedback.put(runtime.store, {
    sessionId: String(args.sessionId ?? ""),
    messageId: String(args.messageId ?? ""),
    rating: args.rating,
    note: args.note,
    notePresent: Object.prototype.hasOwnProperty.call(args, "note"),
    ifVersion: args.ifVersion,
  });
};

/** DSH Typert `messageFeedback/delete` — retract with CAS. */
export const messageFeedbackDelete: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const args = remoteArgs(payload);
  return runtime.messageFeedback.delete(runtime.store, {
    sessionId: String(args.sessionId ?? ""),
    messageId: String(args.messageId ?? ""),
    ifVersion: args.ifVersion,
  });
};

/** DSH Typert `sessionFeedback/record` — session-level remark (+ optional slice). */
export const sessionFeedbackRecordHandler: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const args = remoteArgs(payload);
  return sessionFeedbackRecord(
    runtime.store,
    {
      sessionId: String(args.sessionId ?? ""),
      text: args.text,
      category: args.category,
    },
    {
      ...(runtime.feedbackSlicesDir !== undefined
        ? { slicesDir: runtime.feedbackSlicesDir }
        : {}),
    },
  );
};
