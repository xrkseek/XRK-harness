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
    "Reply on-channel.",
    "Coding: workspace_list → subagent(workspace_id) | workspace_session_prompt → keep session_id → thread_message; optional thread_upsert.",
    "Team/干员: team_* (=Team UI); coding spawn prefer member_id.",
    "Do not implement in ws_im.",
  ].join("\n"),
  qichuang: [
    "kind=orchestrator (Qichuang) · path=open · shell_confine=off (Sandbox Backend unused).",
    "Vague → skill xrk-demand-translate. Care: xrk-home-config · xrk-plugin-dev-care · xrk-xrk-cleanup · xrk-memory-polish · xrk-mainline-sideline · xrk-skill-merge.",
    "Config parity: settings_* (=Settings UI) · team_* (=Team UI; skill xrk-delegate) · habits → xrk-create-skill.",
    "Dispatch: workspace_session_prompt → keep session_id → thread_message; optional thread_upsert + presence_set.",
    "No nested subagent. Implement on coding peers only.",
  ].join("\n"),
};

/** Compact posture for IM / 奇创 parents. Empty for coding badges and children. */
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
