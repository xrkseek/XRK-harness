/**
 * Reserved Face workspace for IM ↔ Desktop projection (one workspace, many chats).
 */

export const IM_WORKSPACE_ID = "ws_im";

export const IM_WORKSPACE_TITLE = "IM";

/** Session agent-preset badge for IM channel sessions (`FACE_AGENT_PRESETS`). */
export const IM_AGENT_PRESET_ID = "im";

export function isImWorkspaceId(workspaceId: string | undefined): boolean {
  return workspaceId === IM_WORKSPACE_ID;
}
