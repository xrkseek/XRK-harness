/**
 * Turn-start `<seat_identity>` — who you are, who is speaking, who you report to.
 * Keeps standing / playbook free of long identity theater.
 */

import type { FaceRuntime } from "./context.js";
import {
  MANAGER_MEMBER_ID,
  MEMBER_NICKNAME_MAX,
  SUNFLOWER_MEMBER_ID,
} from "./agent-roster-store.js";
import {
  readSeatTitles,
  readUiLocalePreference,
  type SeatTitles,
} from "./seat-titles.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";

const BOSS_NICKNAME_MAX = 24;

/** Formal name with optional nickname: `经理（阿葵）`. */
export function formatNamedSeat(
  formal: string,
  nickname: string | undefined,
): string {
  const name = formal.trim() || "?";
  const nick = nickname?.trim();
  if (!nick) return name;
  return `${name}（${nick}）`;
}

export function clipNickname(
  raw: unknown,
  max = MEMBER_NICKNAME_MAX,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, max);
  return trimmed || undefined;
}

function readBossNickname(
  presenceUser: Record<string, unknown> | undefined,
): string | undefined {
  return clipNickname(presenceUser?.bossNickname, BOSS_NICKNAME_MAX);
}

function bossSeatLabel(
  titles: SeatTitles,
  nickname: string | undefined,
): string {
  return formatNamedSeat(titles.boss, nickname);
}

function resolveMemberSeat(
  runtime: FaceRuntime,
  memberId: string,
  titles: SeatTitles,
): { readonly id: string; readonly label: string } {
  const home = runtime.agentRoster.findHome(memberId);
  const member = home
    ? runtime.agentRoster.get(home.rosterWorkspaceId, memberId)
    : undefined;
  const formal =
    memberId === MANAGER_MEMBER_ID
      ? titles.manager
      : member?.name?.trim() || memberId;
  const nick =
    memberId === SUNFLOWER_MEMBER_ID
      ? undefined
      : clipNickname(member?.nickname);
  return { id: memberId, label: formatNamedSeat(formal, nick) };
}

function managerSeat(runtime: FaceRuntime, titles: SeatTitles): string {
  return resolveMemberSeat(runtime, MANAGER_MEMBER_ID, titles).label;
}

/**
 * Compact seat card for the current session. Empty when the session is unknown.
 */
export function formatSeatIdentity(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const titles = readSeatTitles(
    presenceUser,
    readUiLocalePreference(localeUser),
  );
  const bossNick = readBossNickname(presenceUser);
  const boss = bossSeatLabel(titles, bossNick);
  const titlesLine = `titles: ${titles.boss} / ${titles.manager} / ${titles.agent}`;
  const childLink = runtime.subagents.getByChild(sessionId);

  if (childLink && childLink.mode !== "fork") {
    const you = childLink.memberId
      ? resolveMemberSeat(runtime, childLink.memberId, titles).label
      : childLink.label.trim() || titles.agent;
    const parentId = childLink.parentSessionId;
    const parentIdentity = runtime.sessionIdentities.get(parentId);
    const parentWs = runtime.workspaces.workspaceIdOf(parentId);
    let parent: string;
    if (parentIdentity) {
      parent = resolveMemberSeat(runtime, parentIdentity.memberId, titles).label;
    } else if (parentWs === XIANGYANG_WORKSPACE_ID) {
      parent = resolveMemberSeat(runtime, SUNFLOWER_MEMBER_ID, titles).label;
    } else {
      parent = managerSeat(runtime, titles);
    }
    const humanFace = runtime.subagents.humanFacingSessionId(sessionId);
    return [
      `you: ${you} (subagent)`,
      `speaker: ${boss} (human_face=${humanFace})`,
      `parent: ${parent}`,
      `report: FINAL→parent; ask→parent (card on parent session — ${titles.manager} when parent is ${titles.manager})`,
      titlesLine,
    ].join("\n");
  }

  const identity = runtime.sessionIdentities.get(sessionId);
  if (identity) {
    const you = resolveMemberSeat(runtime, identity.memberId, titles).label;
    return [
      `you: ${you} (agent-home)`,
      `speaker: ${boss}`,
      // Same-lane only: agent-home ↔ agent-home. Project / 向阳 / IM are another lane.
      `collab: other agent-home peers via thread_message (not project/向阳/IM sessions)`,
      `report: ${titles.boss}`,
      titlesLine,
    ].join("\n");
  }

  const ws = runtime.workspaces.workspaceIdOf(sessionId);
  if (ws === XIANGYANG_WORKSPACE_ID) {
    const you = resolveMemberSeat(runtime, SUNFLOWER_MEMBER_ID, titles).label;
    return [
      `you: ${you} (xiangyang)`,
      `speaker: ${boss}`,
      `report: ${titles.boss}`,
      "nickname: locked",
      titlesLine,
    ].join("\n");
  }

  return [
    `you: ${managerSeat(runtime, titles)} (project)`,
    `speaker: ${boss}`,
    `report: ${titles.boss}`,
    titlesLine,
  ].join("\n");
}

export function createSeatIdentityFragmentProvider(runtime: FaceRuntime): {
  readonly id: "seat-identity";
  readonly phases: readonly ["turn-start"];
  produce(ctx: { readonly sessionId: string }): readonly {
    readonly id: string;
    readonly kind: "additional_context";
    readonly text: string;
    readonly phase: "turn-start";
    readonly priority: number;
  }[];
} {
  return {
    id: "seat-identity",
    phases: ["turn-start"],
    produce({ sessionId }) {
      const value = formatSeatIdentity(runtime, sessionId);
      if (!value) return [];
      return [
        {
          id: "additional_context.seat_identity",
          kind: "additional_context",
          text: `<seat_identity>\n${value}\n</seat_identity>`,
          phase: "turn-start",
          // After boss-status (8.2), ahead of collab board (8).
          priority: 8.1,
        },
      ];
    },
  };
}
