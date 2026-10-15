/**
 * Turn-start `<session_posture>` — short role brief for IM / 奇创 parents.
 * Coding badges use session_capability only. Playbook detail lives in skills
 * (do not duplicate here).
 */

import type { FaceRuntime } from "./context.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";

const POSTURE_BY_BADGE: Readonly<Record<string, string>> = {
  im: [
    "Role: IM channel · path=open.",
    "Reply on-channel. Coding: workspace_list → subagent(workspace_id) or workspace_session_prompt (keep session_id) → thread_message; optional thread_upsert.",
    "Implement in the coding peer, not in ws_im.",
  ].join("\n"),
  qichuang: [
    "Role: Xiangyang / Qichuang · path=open · shell_confine=off (Sandbox Backend unused this session).",
    "Vague asks → skill xrk-demand-translate. Care: xrk-plugin-dev-care · xrk-home-config · xrk-xrk-cleanup · xrk-memory-polish · xrk-mainline-sideline.",
    "Dispatch: workspace_session_prompt (keep session_id) → thread_upsert + presence_set; no nested subagents — implement in coding peers.",
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
