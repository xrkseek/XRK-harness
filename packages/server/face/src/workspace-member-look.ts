/**
 * Attach live roster appearance onto agent-home WorkspaceView rows for the
 * sidebar 干员 pane (CompanionBall on the workspace header).
 */
import type { FaceRuntime } from "./context.js";
import { appearanceLookWire } from "./agent-roster-store.js";
import { dressingFromPresence } from "./presence-dressing.js";
import type { FaceWorkspaceView } from "./workspace-registry.js";

export type BoundMemberAppearance = ReturnType<typeof appearanceLookWire>;

export type WorkspaceViewWithMemberLook = FaceWorkspaceView & {
  readonly boundMemberAppearance?: BoundMemberAppearance;
};

/** Resolve current Team look for an agent-home row (undefined for projects). */
export function boundMemberAppearanceOf(
  runtime: FaceRuntime,
  row: Pick<FaceWorkspaceView, "kind" | "boundMemberId">,
): BoundMemberAppearance | undefined {
  if (row.kind !== "agent-home") return undefined;
  const memberId = row.boundMemberId?.trim() ?? "";
  if (!memberId) return undefined;
  const home = runtime.agentRoster.findHome(memberId);
  const member = home
    ? runtime.agentRoster.get(home.rosterWorkspaceId, memberId)
    : undefined;
  if (!member?.appearance) return undefined;
  const stickers = dressingFromPresence(
    runtime.settingsNamespaces.view("ui-presence").value as Record<string, unknown>,
  ).stickers;
  return appearanceLookWire(member.appearance, stickers);
}

/** List / host-frame enrichment. */
export function withBoundMemberLook(
  runtime: FaceRuntime,
  row: FaceWorkspaceView,
): WorkspaceViewWithMemberLook {
  const look = boundMemberAppearanceOf(runtime, row);
  return look ? { ...row, boundMemberAppearance: look } : row;
}

/**
 * Publish `host/workspace-changed` with live Team look on agent-home rows.
 * Session attach / rename / move must use this — a bare registry view would
 * wipe `boundMemberAppearance` and leave the 干员 pane showing only a folder.
 */
export function publishWorkspaceChanged(
  runtime: FaceRuntime,
  row: FaceWorkspaceView | Omit<FaceWorkspaceView, "sessionIds">,
): void {
  // findAgentHomeByMember returns the stored row without sessionIds; clients
  // only need look/title refresh here — empty list is fine for that event.
  const workspace: FaceWorkspaceView =
    "sessionIds" in row ? row : { ...row, sessionIds: [] };
  runtime.bus.publishHost({
    type: "host/workspace-changed",
    workspace: withBoundMemberLook(runtime, workspace),
  });
}
