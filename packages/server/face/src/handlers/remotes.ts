import {
  executeFaceCommand,
  listFaceCommandDescriptors,
} from "../slash.js";
import { listFacePluginInventory } from "../plugin-inventory.js";
import { buildFaceChannelDiscover, resolveImGatewayWired } from "../process-channels.js";
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
