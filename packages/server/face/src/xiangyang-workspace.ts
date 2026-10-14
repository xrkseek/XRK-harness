/**
 * Reserved product default workspace — first-launch home for xrkh care.
 * Distinct from IM (`ws_im`), which is created only when a gateway connects.
 */

import path from "node:path";
import { IM_WORKSPACE_ID } from "./im-workspace.js";

/** Registry id for the product default workspace (stable across upgrades). */
export const XIANGYANG_WORKSPACE_ID = "ws_default";

/** Wire / English product title (UI zh remaps to 向阳空间). */
export const XIANGYANG_WORKSPACE_TITLE = "Xiangyang";

/** Dir name under product home (`~/.xrk/xiangyang-workspace`). */
export const XIANGYANG_WORKSPACE_DIR = "xiangyang-workspace";

/** Locked tool-surface badge for sessions in 向阳空间. */
export const QICHUANG_AGENT_PRESET_ID = "qichuang";

export function isXiangyangWorkspaceId(
  workspaceId: string | undefined,
): boolean {
  return workspaceId === XIANGYANG_WORKSPACE_ID;
}

/** IM + 向阳空间 — orchestration surfaces; permission locked to full access. */
export function isOrchestrationWorkspaceId(
  workspaceId: string | undefined,
): boolean {
  return (
    workspaceId === XIANGYANG_WORKSPACE_ID || workspaceId === IM_WORKSPACE_ID
  );
}

/** Absolute path for the reserved 向阳空间 directory. */
export function xiangyangWorkspacePath(productHome: string): string {
  return path.join(path.resolve(productHome), XIANGYANG_WORKSPACE_DIR);
}
