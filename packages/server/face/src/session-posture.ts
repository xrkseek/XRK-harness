/**
 * Turn-start `<session_posture>` — verb card. Facts stay in capability;
 * who/titles stay in `<seat_identity>`. Skills hold playbooks.
 *
 * Workspace kinds: manager-kind (Xiangyang + coding) vs agent-kind (agent-home).
 * Seat words come from Settings titles — never hardcode 老板/经理/干员.
 */

import type { FaceRuntime } from "./context.js";
import { isAgentHomeSession } from "./agent-home-boundary.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { sunflowerFormalName } from "./catalog-seed-labels.js";
import {
  readSeatTitles,
  readUiLocalePreference,
  type SeatTitleLocale,
  type SeatTitles,
} from "./seat-titles.js";

function readTitlesAndLocale(runtime: FaceRuntime): {
  readonly titles: SeatTitles;
  readonly locale: SeatTitleLocale;
} {
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const locale = readUiLocalePreference(localeUser);
  return { titles: readSeatTitles(presenceUser, locale), locale };
}

function agentHomePosture(t: SeatTitles): string {
  return [
    `kind=coding_parent (${t.agent}工作区) · path=open`,
    `Specialty / mechanical playbook. ui=${t.boss} may speak here. You are not a ${t.manager}工作区.`,
    `Peer: workspace_session_prompt → thread_message (${t.agent}工作区 + 向阳 only). Never coding ${t.manager}工作区. Config/team_home → 向阳.`,
  ].join("\n");
}

function postureByBadge(
  t: SeatTitles,
  sunflower: string,
): Readonly<Record<string, string>> {
  return {
    im: [
      "kind=orchestrator (IM) · path=open",
      "On-channel: im_send / bridge.",
      `${t.manager}工作区: workspace_list → subagent(workspace_id) | workspace_session_prompt → keep session_id → thread_message.`,
      "Team: team_*; spawn prefer member_id. Never implement in ws_im.",
    ].join("\n"),
    qichuang: [
      `kind=orchestrator (${sunflower} · ${t.manager}工作区/向阳) · path=open · shell_confine=off`,
      `You are a ${t.manager}. Coding = peer ${t.manager}工作区. ${t.agent}工作区 = specialty homes.`,
      "Route, don't ship → skill xrk-demand-translate. Host/config/cleanup/team_home here.",
      `Project → workspace_list → create? → prompt peer ${t.manager}. Specialty → team_list → team_home → prompt ${t.agent}工作区.`,
      "No nested subagent. Keep session_id → thread_message.",
    ].join("\n"),
    harness: [
      `kind=coding_parent (${t.manager}工作区) · path=open`,
      `You are a ${t.manager}. ${sunflower} = peer ${t.manager} (orch / config / open seats). Ship multi-dim work here.`,
      `Spawn: subagent(member_id). Specialty → ${t.agent}工作区. settings_*=VALUES only; create·delete WS → 向阳.`,
    ].join("\n"),
    shallow: [
      `kind=coding_parent (${t.manager}工作区 · Shallow) · path=open`,
      `You are a ${t.manager}. ${sunflower} = peer ${t.manager}. Ship here; spawn subagent(member_id) when parallel helps (cap 2).`,
      `Specialty → ${t.agent}工作区. settings_*=VALUES only; create·delete WS → 向阳.`,
    ].join("\n"),
  };
}

/** Compact posture for IM / 奇创 / harness·shallow / agent-home. Empty for Frugal/Shell/children. */
export function formatSessionPosture(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  if (runtime.subagents.getByChild(sessionId)) return "";
  const { titles, locale } = readTitlesAndLocale(runtime);
  if (isAgentHomeSession(runtime, sessionId)) return agentHomePosture(titles);
  const byBadge = postureByBadge(titles, sunflowerFormalName(locale));
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const hit = byBadge[badge];
  if (hit) return hit;
  const ws = runtime.workspaces.workspaceIdOf(sessionId);
  if (ws === IM_WORKSPACE_ID) return byBadge.im!;
  if (ws === XIANGYANG_WORKSPACE_ID) return byBadge.qichuang!;
  return "";
}

export function createSessionPostureFragmentProvider(runtime: FaceRuntime): {
  readonly id: "session-posture";
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
    id: "session-posture",
    phases: ["turn-start"],
    produce({ sessionId }) {
      const value = formatSessionPosture(runtime, sessionId);
      if (!value) return [];
      return [
        {
          id: "additional_context.session_posture",
          kind: "additional_context",
          text: `<session_posture>\n${value}\n</session_posture>`,
          phase: "turn-start",
          priority: 8.5,
        },
      ];
    },
  };
}
