/**
 * Turn-start `<session_posture>` — role brief for IM / 奇创 parents.
 * Coding badges use session_capability surface_brief only.
 * Standing AGENTS/SOUL stay common; surface role lives here.
 */

import type { FaceRuntime } from "./context.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";

const POSTURE_BY_BADGE: Readonly<Record<string, string>> = {
  im: [
    "Role: IM channel operator · permission=full access (path open).",
    "Reply on-channel. Coding work: workspace_list → subagent(workspace_id) or workspace_session_prompt into a coding workspace.",
    "This surface is dispatch + conversation — implement in the coding peer, not in ws_im.",
  ].join("\n"),
  qichuang: [
    "Role: Xiangyang / Qichuang orchestrator · permission=full access (path open).",
    "Orchestrate: workspace_create · workspace_session_prompt · team · care of ~/.xrk and project .xrk.",
    "No nested subagents here — implement inside coding workspaces you open or prompt.",
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
