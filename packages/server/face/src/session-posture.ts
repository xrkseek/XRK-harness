/**
 * Turn-start `<session_posture>` — Codex-style verb card for IM / 奇创.
 * Facts (badge · path · tools) stay in `<session_capability>`. Skills hold
 * playbooks — this fragment only names the hub skill and the dispatch chain.
 */

import type { FaceRuntime } from "./context.js";
import { isAgentHomeSession } from "./agent-home-boundary.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";

/** 干员家 identity seat — badge may still say harness; lane ≠ 项目经理. */
const AGENT_HOME_POSTURE = [
  "kind=coding_parent (干员家) · path=open",
  "Peer: workspace_session_prompt → thread_message (homes + 向阳 only). Never project coding. Mint/settings → 向阳.",
].join("\n");

const POSTURE_BY_BADGE: Readonly<Record<string, string>> = {
  // Identity/report lives in <seat_identity>; this card is verbs only.
  // Lane rules live on the collab board — posture = dispatch chain.
  // Frugal / Shell: no card — surface_brief + board already say no spawn.
  im: [
    "kind=orchestrator (IM) · path=open",
    "On-channel: im_send / bridge.",
    "Coding: workspace_list → subagent(workspace_id) | workspace_session_prompt → keep session_id → thread_message; optional thread_upsert.",
    "Team: team_* (=Team UI); spawn prefer member_id. Never implement in ws_im.",
  ].join("\n"),
  qichuang: [
    "kind=orchestrator (向日葵 / 奇创 · 向阳经理席) · path=open · shell_confine=off",
    "Admin: settings_* · workspace_create/list · team_* · care skills (xrk-home-config · xrk-demand-translate · …).",
    "Vague → skill xrk-demand-translate.",
    "Dispatch: workspace_session_prompt → keep session_id → thread_message; optional thread_upsert + presence_set.",
    "No nested subagent — coding peers ship. titles.manager = peer (not boss).",
  ].join("\n"),
  harness: [
    "kind=coding_parent (项目经理席) · path=open",
    "Peer: workspace_session_prompt → thread_message. Spawn: subagent(member_id). List: workspace_list.",
    "settings_* = VALUES only; schema / reserved ns / create·delete WS → 向阳 (ws_default). 向日葵 = peer.",
  ].join("\n"),
  shallow: [
    "kind=coding_parent (项目经理席 · Shallow) · path=open",
    "Peer: workspace_session_prompt → thread_message. Spawn: subagent(member_id) when parallel helps (cap 2).",
    "settings_* = VALUES only; schema / reserved ns / create·delete WS → 向阳. 向日葵 = peer.",
  ].join("\n"),
};

/** Compact posture for IM / 奇创 / harness·shallow / 干员家. Empty for Frugal/Shell/children. */
export function formatSessionPosture(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  if (runtime.subagents.getByChild(sessionId)) return "";
  // Before badge: identity office must not inherit 项目经理 harness template.
  if (isAgentHomeSession(runtime, sessionId)) return AGENT_HOME_POSTURE;
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const byBadge = POSTURE_BY_BADGE[badge];
  if (byBadge) return byBadge;
  const ws = runtime.workspaces.workspaceIdOf(sessionId);
  if (ws === IM_WORKSPACE_ID) return POSTURE_BY_BADGE.im!;
  if (ws === XIANGYANG_WORKSPACE_ID) return POSTURE_BY_BADGE.qichuang!;
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
