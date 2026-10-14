/**
 * One-shot membership repair: before 向阳空间 reused `ws_default`, coding
 * sessions lived on that id. Move non-奇创 sessions onto a coding workspace.
 * Also re-pins IM / 向阳空间 sessions to full access (legacy Settings default).
 */

import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import {
  QICHUANG_AGENT_PRESET_ID,
  XIANGYANG_WORKSPACE_ID,
  isOrchestrationWorkspaceId,
} from "./xiangyang-workspace.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { persistWorkspaceDoc } from "./workspace-store.js";
import {
  applyPermissionPreset,
  permissionSelectFromEvents,
} from "./permissions.js";

/**
 * Relocate legacy coding sessions out of 向阳空间.
 * @param runtime - Face runtime after workspace hydrate / ensureReserved.
 * @param codingWorkspaceId - Target coding workspace (usually launch cwd).
 * @returns number of sessions moved.
 */
export function migrateLegacyXiangyangCodingSessions(
  runtime: FaceRuntime,
  codingWorkspaceId: string,
): number {
  const target = codingWorkspaceId.trim();
  if (
    !target ||
    target === XIANGYANG_WORKSPACE_ID ||
    target === IM_WORKSPACE_ID ||
    !runtime.workspaces.get(target)
  ) {
    return 0;
  }

  let moved = 0;
  for (const [sessionId, wsId] of runtime.workspaces.listMembership()) {
    if (wsId !== XIANGYANG_WORKSPACE_ID) continue;
    const badge = runtime.sessionAgentPresets.get(sessionId);
    if (badge === QICHUANG_AGENT_PRESET_ID) continue;
    if (runtime.workspaces.attachSession(sessionId, target)) moved += 1;
  }
  return moved;
}

/**
 * Resolve the coding workspace that should absorb legacy `ws_default` sessions.
 * Prefer the launch cwd row; otherwise the first non-reserved workspace.
 */
export function resolveCodingMigrateTarget(
  runtime: FaceRuntime,
  launchRoot: string,
): string | undefined {
  const byPath = runtime.workspaces.findByPath(launchRoot);
  if (
    byPath &&
    byPath.workspaceId !== XIANGYANG_WORKSPACE_ID &&
    byPath.workspaceId !== IM_WORKSPACE_ID
  ) {
    return byPath.workspaceId;
  }
  const hit = runtime.workspaces
    .list(runtime.store.list())
    .items.find(
      (w) =>
        w.workspaceId !== XIANGYANG_WORKSPACE_ID &&
        w.workspaceId !== IM_WORKSPACE_ID,
    );
  return hit?.workspaceId;
}

/**
 * IM / 向阳空间 must stay on full access. Older installs pinned Settings
 * `workspace-write` before the orch lock — rewrite those knobs.
 */
export function repairOrchestrationSessionPermissions(
  runtime: FaceRuntime,
): number {
  let fixed = 0;
  for (const [sessionId, wsId] of runtime.workspaces.listMembership()) {
    if (!isOrchestrationWorkspaceId(wsId)) continue;
    if (!runtime.store.has(sessionId)) continue;
    const current = permissionSelectFromEvents(
      readSessionEvents(runtime.store, sessionId),
    ).currentValue;
    if (current === "danger-full-access") continue;
    const applied = applyPermissionPreset(
      runtime.store,
      sessionId,
      "danger-full-access",
    );
    if (applied.ok && applied.changed) fixed += 1;
  }
  return fixed;
}

/** Run migrate + permission repair; persist when membership moved. */
export async function runXiangyangCodingSessionMigrate(
  runtime: FaceRuntime,
  launchRoot: string,
): Promise<number> {
  const target = resolveCodingMigrateTarget(runtime, launchRoot);
  const moved = target
    ? migrateLegacyXiangyangCodingSessions(runtime, target)
    : 0;
  repairOrchestrationSessionPermissions(runtime);
  if (moved > 0) {
    await persistWorkspaceDoc(runtime, runtime.workspaces);
  }
  return moved;
}
