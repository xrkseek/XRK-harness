import type { FaceRuntime } from "./context.js";
import { errResponse, okResponse } from "./wire/envelope.js";
import type { FaceRpcResponse } from "./types.js";
import {
  workspaceArchiveSessionFace,
  workspaceCreateFace,
  workspaceDeleteFace,
  workspaceDescribe,
  workspaceInsertBeforeFace,
  workspaceInsertSessionBeforeFace,
  workspaceListFace,
  workspaceListProduct,
  workspacePreviewInject,
  workspaceRenameFace,
  workspaceSyncSeeds,
} from "./workspace-face.js";
import {
  credentialsDescribe,
  credentialsList,
  credentialsSet,
  credentialsUnset,
  settingsDescribeFace,
  settingsGet,
  settingsMutateFace,
  settingsReplaceFace,
  settingsOpenDocument,
  settingsSet,
  settingsUpdateFace,
} from "./settings-credentials.js";
import { skillList } from "./skill-list.js";
import { resolveSessionCwd } from "./session-cwd.js";
import {
  bindPayload,
  bindRuntime,
  notImplemented,
  type FaceHandler,
} from "./handlers/types.js";
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
  agentPresetReadOnly,
  agentPresetSelect,
  llmDiscoverModels,
  llmModels,
  llmProviders,
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
  costMeterFetchPricesRemote,
  costMeterGetDaySessionsRemote,
  costMeterGetStateRemote,
  costMeterGetTopSessionsRemote,
  costMeterImportLegacyHistoryRemote,
  costMeterRefreshBalanceRemote,
  costMeterRefreshCodingPlanRemote,
  costMeterRefreshCustomBalanceRemote,
  costMeterRefreshGoQuotaRemote,
  costMeterResetHistoryRemote,
  costMeterUpdateConfigRemote,
} from "./handlers/cost-meter.js";
import {
  goalsClear,
  goalsComplete,
  goalsCreate,
  goalsEdit,
  goalsPause,
  goalsResume,
} from "./handlers/goals.js";
import { cordisRunnerHandler } from "./handlers/cordis-stub.js";
import {
  fileReferencesList,
  sessionReferenceResolverCandidates,
} from "./handlers/references.js";

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
  "agentPreset.copy": agentPresetReadOnly,
  "agentPreset.openDocument": agentPresetReadOnly,
  "agentPreset.remove": agentPresetReadOnly,
  "llm.providers": llmProviders,
  "llm.models": llmModels,
  "llm.discoverModels": llmDiscoverModels,
  "workspace.describe": bindRuntime(workspaceDescribe),
  "workspace.listProduct": bindRuntime(workspaceListProduct),
  "workspace.list": bindRuntime(workspaceListFace),
  "workspace.create": bindPayload(workspaceCreateFace),
  "workspace.rename": bindPayload(workspaceRenameFace),
  "workspace.archiveSession": bindPayload(workspaceArchiveSessionFace),
  "workspace.delete": bindPayload(workspaceDeleteFace),
  "workspace.insertBefore": bindPayload(workspaceInsertBeforeFace),
  "workspace.insertSessionBefore": bindPayload(workspaceInsertSessionBeforeFace),
  "workspace.previewInject": bindPayload(workspacePreviewInject),
  "workspace.syncSeeds": bindPayload(workspaceSyncSeeds),
  "settings.get": bindPayload(settingsGet),
  "settings.describe": bindRuntime(settingsDescribeFace),
  "settings.mutate": bindPayload(settingsMutateFace),
  "settings.update": bindPayload(settingsUpdateFace),
  "settings.replace": bindPayload(settingsReplaceFace),
  "settings.set": bindPayload(settingsSet),
  "settings.openDocument": bindRuntime(settingsOpenDocument),
  "credentials.list": bindRuntime(credentialsList),
  "credentials.describe": bindPayload(credentialsDescribe),
  "credentials.set": bindPayload(credentialsSet),
  "credentials.unset": bindPayload(credentialsUnset),
  "skill.list": bindPayload((runtime, payload) => {
    const sessionId = String(
      (payload as Record<string, unknown> | null)?.sessionId ?? "",
    ).trim();
    const root = sessionId
      ? resolveSessionCwd(runtime, sessionId)
      : runtime.workspaceRoot;
    return skillList(root, payload);
  }),
  "subagent.list": subagentList,
  "subagent.history": subagentHistory,
  "subagent.prompt": subagentPrompt,
  "subagent.interrupt": subagentInterrupt,
  "commands/list": commandsList,
  "commands/execute": commandsExecute,
  "pluginInventory/list": pluginInventoryList,
  "messageFeedback/list": messageFeedbackList,
  "messageFeedback/put": messageFeedbackPut,
  "messageFeedback/delete": messageFeedbackDelete,
  "costMeter/getState": bindRuntime(() => costMeterGetStateRemote()),
  "costMeter/updateConfig": bindPayload(costMeterUpdateConfigRemote),
  "costMeter/fetchPrices": bindRuntime(() => costMeterFetchPricesRemote()),
  "costMeter/resetHistory": bindRuntime(() => costMeterResetHistoryRemote()),
  "costMeter/importLegacyHistory": bindRuntime((runtime) =>
    costMeterImportLegacyHistoryRemote(runtime),
  ),
  "costMeter/refreshBalance": bindRuntime(() =>
    costMeterRefreshBalanceRemote(),
  ),
  "costMeter/refreshGoQuota": bindRuntime(() =>
    costMeterRefreshGoQuotaRemote(),
  ),
  "costMeter/refreshCustomBalance": bindRuntime(() =>
    costMeterRefreshCustomBalanceRemote(),
  ),
  "costMeter/refreshCodingPlan": bindPayload(costMeterRefreshCodingPlanRemote),
  "costMeter/getDaySessions": bindPayload(costMeterGetDaySessionsRemote),
  "costMeter/getTopSessions": bindPayload(costMeterGetTopSessionsRemote),
  "goals/create": goalsCreate,
  "goals/edit": goalsEdit,
  "goals/pause": goalsPause,
  "goals/resume": goalsResume,
  "goals/complete": goalsComplete,
  "goals/clear": goalsClear,
  // DSH connection.api.goals.* posts dotted unary (shell remotes still use goals/).
  "goal.create": goalsCreate,
  "goal.edit": goalsEdit,
  "goal.pause": goalsPause,
  "goal.resume": goalsResume,
  "goal.complete": goalsComplete,
  "goal.clear": goalsClear,
  "fileReferences/list": fileReferencesList,
  "sessionReferenceResolver/candidates": sessionReferenceResolverCandidates,
};

export function getHandler(method: string): FaceHandler | undefined {
  return HANDLERS[method] ?? cordisRunnerHandler(method);
}

export async function dispatchFaceMethod(
  runtime: FaceRuntime,
  method: string,
  rpcId: string,
  payload: unknown,
): Promise<FaceRpcResponse> {
  const handler = getHandler(method) ?? notImplemented;
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
