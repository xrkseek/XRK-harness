/**
 * Turn-start `<session_posture>` — Codex-style verb card for IM / 奇创.
 * Facts (badge · path · tools) stay in `<session_capability>`. Skills hold
 * playbooks — this fragment only names the hub skill and the dispatch chain.
 */

import type { FaceRuntime } from "./context.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";

const POSTURE_BY_BADGE: Readonly<Record<string, string>> = {
  im: [
    "kind=orchestrator (IM) · path=open",
    "Reply on-channel (im_send / bridge).",
    "Coding: workspace_list → subagent(workspace_id) | workspace_session_prompt → keep session_id → thread_message; optional thread_upsert.",
    "Team/干员: team_* (=Team UI); coding spawn prefer member_id.",
    "Do not implement in ws_im.",
  ].join("\n"),
  qichuang: [
    "kind=orchestrator (向日葵 / 奇创) · path=open · shell_confine=off.",
    "Admin seat: settings_* · workspace_create/list · team_* · care skills (xrk-home-config · xrk-demand-translate · …).",
    "Vague → skill xrk-demand-translate.",
    "Dispatch: workspace_session_prompt → keep session_id → thread_message; optional thread_upsert + presence_set.",
    "No nested subagent. Implement on coding peers only.",
  ].join("\n"),
  // Coding 经理席 — thin guide; admin on 向阳; peer work via new session in a coding ws.
  harness: [
    "kind=coding_parent (经理席) · path=open",
    "Same-project peer: workspace_session_prompt(workspace_id) → new/existing session → thread_message (delegation tree optional).",
    "Spawn: subagent(member_id). List: workspace_list.",
    "Settings / create·delete workspaces → 向阳空间 (open or new session there). This seat stays coding-light.",
  ].join("\n"),
};

const CODING_MANAGER_BADGES = new Set([
  "harness",
  "shallow",
  "frugal",
  "shell",
]);

/** Compact posture for IM / 奇创 / coding 经理 parents. Empty for children. */
export function formatSessionPosture(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  if (runtime.subagents.getByChild(sessionId)) return "";
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const byBadge = POSTURE_BY_BADGE[badge];
  if (byBadge) return byBadge;
  const ws = runtime.workspaces.workspaceIdOf(sessionId);
  if (ws === IM_WORKSPACE_ID) return POSTURE_BY_BADGE.im!;
  if (ws === XIANGYANG_WORKSPACE_ID) return POSTURE_BY_BADGE.qichuang!;
  if (CODING_MANAGER_BADGES.has(badge)) return POSTURE_BY_BADGE.harness!;
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
