import {
  executeFaceCommand,
  listFaceCommandDescriptors,
} from "../slash.js";
import { listFaceAgentPresetGroups } from "../plugin-agent-presets.js";
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
import { publishRemoteEvent } from "../remote-event.js";
import { sessionFeedbackRecord } from "../session-feedback.js";
import { remoteArgs, type FaceHandler } from "./types.js";

/** Ids / aliases Face should force-remount after disk mutate. */
function reloadIdsForEntry(entry: {
  readonly entryId: string;
  readonly moduleName?: string;
}): string[] {
  const ids = [entry.entryId];
  if (entry.moduleName?.trim()) ids.push(entry.moduleName.trim());
  return ids;
}

/** Best-effort package name from a CLI install spec (`name`, `name@ver`, `@scope/name@ver`). */
function packageNameFromInstallSpec(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith("github:") ||
    trimmed.startsWith("file:") ||
    trimmed.startsWith(".") ||
    trimmed.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  ) {
    return undefined;
  }
  if (trimmed.startsWith("@")) {
    const m = trimmed.match(/^(@[^/]+\/[^@]+)(?:@|$)/);
    return m?.[1];
  }
  const at = trimmed.indexOf("@");
  return at === -1 ? trimmed : trimmed.slice(0, at);
}

/** Match inventory rows that an install spec likely updated. */
function reloadIdsForInstallSpec(
  runtime: Parameters<FaceHandler>[0],
  spec: string,
): string[] {
  const bare = packageNameFromInstallSpec(spec);
  const out = new Set<string>();
  for (const entry of listFacePluginInventory(runtime)) {
    if (!entry.managed) continue;
    const hit =
      entry.source === spec ||
      entry.entryId === spec ||
      entry.moduleName === spec ||
      (bare !== undefined &&
        (entry.entryId === bare || entry.moduleName === bare));
    if (!hit) continue;
    for (const id of reloadIdsForEntry(entry)) out.add(id);
  }
  if (bare) out.add(bare);
  return [...out];
}

/** Merge Host CLI mutate streams for Settings TerminalBlock. */
function mutateLogFromResult(
  command: string,
  result: {
    readonly ok: boolean;
    readonly stdout?: string;
    readonly stderr?: string;
  },
): { readonly command: string; readonly output: string; readonly exitCode: number } {
  const stdout = result.stdout?.trimEnd() ?? "";
  const stderr = result.stderr?.trimEnd() ?? "";
  const output =
    stdout.length > 0 && stderr.length > 0
      ? `${stdout}\n${stderr}`
      : stdout.length > 0
        ? stdout
        : stderr;
  return {
    command,
    output,
    exitCode: result.ok ? 0 : 1,
  };
}

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

/** DSH `pluginInventory/list` — global entries + session badge compositions. */
export const pluginInventoryList: FaceHandler = async (runtime) => ({
  ok: true,
  value: {
    entries: listFacePluginInventory(runtime),
    agentPresets: listFaceAgentPresetGroups(runtime),
  },
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
  const log = mutateLogFromResult(`xrkh plugin add ${spec}`, result);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "failed",
        message: result.error ?? `plugin update failed for ${entryId}`,
        details: { ...log },
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
  await runtime.syncManagedProcessPlugins?.({
    reloadIds: reloadIdsForEntry(entry),
  });
  return {
    ok: true,
    value: { entryId, updated: true as const, ...log },
  };
};

/**
 * Remount a managed process plugin from disk without reinstalling
 * (Settings “reload” / local edit hot path).
 */
export const pluginInventoryReload: FaceHandler = async (runtime, _rpcId, payload) => {
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
      error: { code: "refused", message: "builtin plugins cannot be reloaded here" },
    };
  }
  if (!runtime.syncManagedProcessPlugins) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: "Host process-plugin sync is not wired",
      },
    };
  }
  await runtime.syncManagedProcessPlugins({
    reloadIds: reloadIdsForEntry(entry),
  });
  return { ok: true, value: { entryId, reloaded: true as const } };
};

/**
 * Install a plugin by CLI-compatible spec (registry name, `name@version`,
 * `github:…`, path). Same Host path as Settings update / `xrkh plugin add`.
 */
export const pluginInventoryInstall: FaceHandler = async (runtime, rpcId, payload) => {
  const args = remoteArgs(payload);
  const spec = String(args.spec ?? "").trim();
  const registry = String(args.registry ?? "").trim();
  const requestId = String(args.requestId ?? rpcId).trim() || rpcId;
  if (!spec) {
    return { ok: false, error: { code: "invalid-payload", message: "spec required" } };
  }
  if (!runtime.updateUserPlugin) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: registry
          ? `Use: xrkh plugin add --registry ${registry} ${spec}`
          : `Use: xrkh plugin add ${spec}`,
      },
    };
  }
  const onChunk = (chunk: {
    readonly stream: "stdout" | "stderr";
    readonly text: string;
  }): void => {
    publishRemoteEvent(runtime.bus, "plugin-inventory/install-log", [
      requestId,
      chunk.stream,
      chunk.text,
    ]);
  };
  const mutateOpts = {
    onChunk,
    ...(registry ? { registry } : {}),
  };
  const result = await runtime.updateUserPlugin(spec, mutateOpts);
  const command = registry
    ? `xrkh plugin add --registry ${registry} ${spec}`
    : `xrkh plugin add ${spec}`;
  const log = mutateLogFromResult(command, result);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "failed",
        message: result.error ?? `plugin install failed for ${spec}`,
        details: { ...log },
      },
    };
  }
  reconcileManagedClientBoot(runtime);
  await runtime.syncManagedProcessPlugins?.({
    reloadIds: reloadIdsForInstallSpec(runtime, spec),
  });
  return {
    ok: true,
    value: { spec, installed: true as const, ...log },
  };
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
