import type { FaceRuntime } from "./context.js";
import { errResponse, okResponse } from "./wire/envelope.js";
import type { FaceRpcResponse } from "./types.js";
import {
  workspaceArchiveSessionDsh,
  workspaceCreateDsh,
  workspaceDeleteDsh,
  workspaceDescribe,
  workspaceInsertBeforeDsh,
  workspaceInsertSessionBeforeDsh,
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
  settingsOpenDocument,
  settingsSet,
  settingsUpdateDsh,
} from "./settings-credentials.js";
import { skillList } from "./skill-list.js";
import { notImplemented, type FaceHandler } from "./handlers/types.js";
import {
  hostCreateDirectoryHandler,
  hostDescribe,
  hostListDirectoryHandler,
  hostOpenPathHandler,
  hostPickDirectory,
} from "./handlers/host.js";
import {
  sessionCancel,
  sessionCreate,
  sessionFork,
  sessionHistory,
  sessionList,
  sessionModels,
  sessionPrompt,
  sessionRename,
  sessionRespondApproval,
  sessionSearch,
  sessionSelectModel,
  sessionUpdateQueue,
} from "./handlers/session.js";
import {
  agentPresetList,
  agentPresetRead,
  agentPresetSelect,
  llmModels,
  llmProviders,
  llmDiscoverModels,
  sessionAttachment,
} from "./handlers/catalog.js";
import {
  subagentHistory,
  subagentInterrupt,
  subagentList,
  subagentPrompt,
} from "./handlers/subagent.js";
import {
  commandsExecute,
  commandsList,
  messageFeedbackDelete,
  messageFeedbackList,
  messageFeedbackPut,
  pluginInventoryList,
} from "./handlers/remotes.js";
import {
  goalsClear,
  goalsComplete,
  goalsCreate,
  goalsEdit,
  goalsPause,
  goalsResume,
} from "./handlers/goals.js";

const HANDLERS: Record<string, FaceHandler> = {
  "host.describe": hostDescribe,
  "host.pickDirectory": hostPickDirectory,
  "host.listDirectory": hostListDirectoryHandler,
  "host.createDirectory": hostCreateDirectoryHandler,
  "host.openPath": hostOpenPathHandler,
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
  "session.attachment": sessionAttachment,
  "agentPreset.list": agentPresetList,
  "agentPreset.select": agentPresetSelect,
  "agentPreset.read": agentPresetRead,
  "llm.providers": llmProviders,
  "llm.models": llmModels,
  "llm.discoverModels": llmDiscoverModels,
  "workspace.describe": async (runtime) => workspaceDescribe(runtime),
  "workspace.listProduct": async (runtime) => workspaceListProduct(runtime),
  "workspace.list": async (runtime) => workspaceListDsh(runtime),
  "workspace.create": async (runtime, _rpcId, payload) =>
    workspaceCreateDsh(runtime, payload),
  "workspace.rename": async (runtime, _rpcId, payload) =>
    workspaceRenameDsh(runtime, payload),
  "workspace.archiveSession": async (runtime, _rpcId, payload) =>
    workspaceArchiveSessionDsh(runtime, payload),
  "workspace.delete": async (runtime, _rpcId, payload) =>
    workspaceDeleteDsh(runtime, payload),
  "workspace.insertBefore": async (runtime, _rpcId, payload) =>
    workspaceInsertBeforeDsh(runtime, payload),
  "workspace.insertSessionBefore": async (runtime, _rpcId, payload) =>
    workspaceInsertSessionBeforeDsh(runtime, payload),
  "workspace.previewInject": async (runtime, _rpcId, payload) =>
    workspacePreviewInject(runtime, payload),
  "workspace.syncSeeds": async (runtime, _rpcId, payload) =>
    workspaceSyncSeeds(runtime, payload),
  "settings.get": async (runtime, _rpcId, payload) =>
    settingsGet(runtime, payload),
  "settings.describe": async (runtime) => settingsDescribeDsh(runtime),
  "settings.mutate": async (runtime, _rpcId, payload) =>
    settingsMutateDsh(runtime, payload),
  "settings.update": async (runtime, _rpcId, payload) =>
    settingsUpdateDsh(runtime, payload),
  "settings.replace": async (runtime, _rpcId, payload) =>
    settingsReplaceDsh(runtime, payload),
  "settings.set": async (runtime, _rpcId, payload) =>
    settingsSet(runtime, payload),
  "settings.openDocument": async (runtime) => settingsOpenDocument(runtime),
  "credentials.list": async (runtime) => credentialsList(runtime),
  "credentials.describe": async (runtime, _rpcId, payload) =>
    credentialsDescribe(runtime, payload),
  "credentials.set": async (runtime, _rpcId, payload) =>
    credentialsSet(runtime, payload),
  "credentials.unset": async (runtime, _rpcId, payload) =>
    credentialsUnset(runtime, payload),
  // Skills from workspace .xrk/skills/<id>/SKILL.md
  "skill.list": async (runtime, _rpcId, payload) =>
    skillList(runtime.workspaceRoot, payload),
  "subagent.list": subagentList,
  "subagent.history": subagentHistory,
  "subagent.prompt": subagentPrompt,
  "subagent.interrupt": subagentInterrupt,
  "agentPreset.copy": notImplemented,
  "agentPreset.openDocument": notImplemented,
  "agentPreset.remove": notImplemented,
  "commands/list": commandsList,
  "commands/execute": commandsExecute,
  "pluginInventory/list": pluginInventoryList,
  "messageFeedback/list": messageFeedbackList,
  "messageFeedback/put": messageFeedbackPut,
  "messageFeedback/delete": messageFeedbackDelete,
  "goals/create": goalsCreate,
  "goals/edit": goalsEdit,
  "goals/pause": goalsPause,
  "goals/resume": goalsResume,
  "goals/complete": goalsComplete,
  "goals/clear": goalsClear,
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
    return errResponse(
      rpcId,
      result.error.code,
      result.error.message,
      result.error.details,
    );
  } catch (err) {
    return errResponse(
      rpcId,
      "internal",
      err instanceof Error ? err.message : String(err),
    );
  }
}
