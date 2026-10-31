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
  catalogSeedDisplayLabel,
} from "./catalog-seed-labels.js";
import {
  readSeatTitles,
  readUiLocalePreference,
  type SeatTitleLocale,
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

/** Boss formal（nickname） from live Settings — used by seat-channel prefixes. */
export function bossSeatLabelFromRuntime(
  runtime: FaceRuntime,
  titles?: SeatTitles,
): string {
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const seatTitles =
    titles
    ?? readSeatTitles(presenceUser, readUiLocalePreference(localeUser));
  return bossSeatLabel(seatTitles, readBossNickname(presenceUser));
}

function resolveRosterMember(
  runtime: FaceRuntime,
  memberId: string,
) {
  const id = memberId.trim();
  if (!id) return undefined;
  const home = runtime.agentRoster.findHome(id);
  return home ? runtime.agentRoster.get(home.rosterWorkspaceId, id) : undefined;
}

function resolveMemberSeat(
  runtime: FaceRuntime,
  memberId: string,
  titles: SeatTitles,
  locale: SeatTitleLocale = "zh",
): { readonly id: string; readonly label: string } {
  const member = resolveRosterMember(runtime, memberId);
  const nick = clipNickname(member?.nickname);
  const fromCatalog = catalogSeedDisplayLabel(memberId, locale, {
    seatTitles: titles,
    ...(nick ? { nickname: nick } : {}),
  });
  if (fromCatalog) return { id: memberId, label: fromCatalog };
  return {
    id: memberId,
    label: formatNamedSeat(member?.name?.trim() || memberId, nick),
  };
}

function managerSeat(
  runtime: FaceRuntime,
  titles: SeatTitles,
  locale: SeatTitleLocale,
): string {
  return resolveMemberSeat(runtime, MANAGER_MEMBER_ID, titles, locale).label;
}

/**
 * Immediate parent seat of a tool-delegated child.
 * Project coding parent → 经理; Xiangyang → 向日葵; nested → mid parent;
 * agent-home → that member. Never the human 老板 (they sit on human_face).
 */
export function resolveChildParentSeat(
  runtime: FaceRuntime,
  parentSessionId: string,
  titles: SeatTitles,
  locale: SeatTitleLocale = "zh",
): {
  readonly label: string;
  readonly memberId?: string;
  readonly surface: "nested" | "identity" | "xiangyang" | "manager";
} {
  const parentLink = runtime.subagents.getByChild(parentSessionId);
  if (parentLink && parentLink.mode !== "fork") {
    const memberId =
      typeof parentLink.memberId === "string" ? parentLink.memberId.trim() : "";
    const label = memberId
      ? resolveMemberSeat(runtime, memberId, titles, locale).label
      : parentLink.label.trim() || titles.agent;
    return {
      label,
      ...(memberId ? { memberId } : {}),
      surface: "nested",
    };
  }
  const parentIdentity = runtime.sessionIdentities.get(parentSessionId);
  if (parentIdentity) {
    const seat = resolveMemberSeat(
      runtime,
      parentIdentity.memberId,
      titles,
      locale,
    );
    return {
      label: seat.label,
      memberId: seat.id,
      surface: "identity",
    };
  }
  const parentWs = runtime.workspaces.workspaceIdOf(parentSessionId);
  if (parentWs === XIANGYANG_WORKSPACE_ID) {
    const seat = resolveMemberSeat(
      runtime,
      SUNFLOWER_MEMBER_ID,
      titles,
      locale,
    );
    return {
      label: seat.label,
      memberId: SUNFLOWER_MEMBER_ID,
      surface: "xiangyang",
    };
  }
  return {
    label: managerSeat(runtime, titles, locale),
    memberId: MANAGER_MEMBER_ID,
    surface: "manager",
  };
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
  const locale = readUiLocalePreference(localeUser);
  const titles = readSeatTitles(presenceUser, locale);
  const bossNick = readBossNickname(presenceUser);
  const boss = bossSeatLabel(titles, bossNick);
  const titlesLine = `titles: ${titles.boss} / ${titles.manager} / ${titles.agent}`;
  const childLink = runtime.subagents.getByChild(sessionId);

  if (childLink && childLink.mode !== "fork") {
    const you = childLink.memberId
      ? resolveMemberSeat(runtime, childLink.memberId, titles, locale).label
      : childLink.label.trim() || titles.agent;
    const parentSeat = resolveChildParentSeat(
      runtime,
      childLink.parentSessionId,
      titles,
      locale,
    );
    const parent = parentSeat.label;
    const humanFace = runtime.subagents.humanFacingSessionId(sessionId);
    // Channel markers use live Settings titles (titleBoss/Manager/Agent or scheme),
    // never hardcoded 老板/经理. UI → [titles.boss…]; parent tool → [report seat].
    return [
      `you: ${you} (subagent · parent_surface=${parentSeat.surface})`,
      `report: ${parent}`,
      `human_face: ${boss} (${humanFace})`,
      `channels: UI→[${boss}] …; parent_tool→[${parent}] …`,
      `ask: card on parent (${parent}); escalate to human_face via parent ask_user`,
      titlesLine,
    ].join("\n");
  }

  const identity = runtime.sessionIdentities.get(sessionId);
  if (identity) {
    const you = resolveMemberSeat(
      runtime,
      identity.memberId,
      titles,
      locale,
    ).label;
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
    const you = resolveMemberSeat(
      runtime,
      SUNFLOWER_MEMBER_ID,
      titles,
      locale,
    ).label;
    return [
      `you: ${you} (xiangyang)`,
      `speaker: ${boss}`,
      `report: ${titles.boss}`,
      "nickname: locked",
      titlesLine,
    ].join("\n");
  }

  return [
    `you: ${managerSeat(runtime, titles, locale)} (project)`,
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
