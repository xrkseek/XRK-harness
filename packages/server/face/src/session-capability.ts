/**
 * Turn-start `<session_capability>` — permission × tool-surface snapshot
 * plus short briefs. Standing AGENTS stays common; this fragment is the
 * per-session axes. Orthogonal to collab board / session_posture.
 */

import { readSessionEvents } from "@xrkseek/core-session";
import {
  effectiveApprovalPolicy,
  effectiveSandboxMode,
  foldPlanMode,
  pathAccessModeFromSandbox,
} from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import {
  FACE_PERMISSION_TABLE,
  permissionSelectFromEvents,
  resolvePermissionPresetSpec,
} from "./permissions.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveAgentPresetProfile } from "./presets-catalog.js";
import { countExposures } from "@xrkseek/core-tools";
import { resolveSessionCwd } from "./session-cwd.js";

/** Affirmative permission copy for the model (path gate only). */
function permissionBrief(permission: string): string {
  const known = resolvePermissionPresetSpec(permission, true)
    ?? resolvePermissionPresetSpec(permission, false);
  if (known) return known.description;
  if (permission === "custom") {
    return "Sandbox/approval do not match a named preset — honor the live path= and approval= lines.";
  }
  const table = FACE_PERMISSION_TABLE[permission as keyof typeof FACE_PERMISSION_TABLE];
  return table?.description ?? `Live permission=${permission}; honor path= and approval=.`;
}

/** Affirmative tool-surface copy (which tools / role). */
function surfaceBrief(badge: string): string {
  switch (badge) {
    case "minimal":
      return "Coding · fs/skill/std only — ship with this catalog; load skills for playbooks.";
    case "shell":
      return "Coding · fs + bash + PTY — no web, lsp, or subagents.";
    case "frugal":
      return "Coding · full tools, no subagents — prefer one session; xrk-plan-build for large work.";
    case "shallow":
      return "Coding · full tools + one-level subagents — spawn when parallel helps (xrk-delegate).";
    case "harness":
      return "Coding · full tools + nested subagents (Face caps) — prefer team_list member_id when spawning.";
    case "im":
      return "IM channel · reply on-channel; dispatch coding via workspace_* / subagent — see <session_posture>.";
    case "qichuang":
      return "Xiangyang · orchestrate peers/team; implement in coding workspaces — see <session_posture>.";
    default:
      return `Tool surface=${badge}; use only tools in your catalog.`;
  }
}

function toolSurfaceSummary(badge: string): string {
  // Orchestration badges: fs bits alone mislead — call out the real surface.
  if (badge === "im") {
    return "im (full-access · channel+list/create/session_prompt+subagent→coding)";
  }
  if (badge === "qichuang") {
    return "qichuang (full-access · team+list/create/session_prompt · no nested subagents)";
  }
  const profile = resolveAgentPresetProfile(badge);
  const bits: string[] = ["fs"];
  if (profile.composition === "harness") bits.push("bash");
  if (profile.tools.web) bits.push("web");
  if (profile.tools.lsp) bits.push("lsp");
  if (profile.tools.pty) bits.push("pty");
  const sub =
    profile.subagents.mode === "off"
      ? "subagents=off"
      : `subagents=${profile.delegation}`;
  return `${badge} (${bits.join("+")} · ${sub})`;
}

/**
 * Compact machine-readable capability block + brief lines.
 */
export function formatSessionCapability(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  // Delegated children get identity from spawn preamble, not this fragment.
  if (runtime.subagents.getByChild(sessionId)) return "";

  const events = readSessionEvents(runtime.store, sessionId);
  const permission = permissionSelectFromEvents(events).currentValue;
  const sandbox = effectiveSandboxMode(events);
  const pathMode = pathAccessModeFromSandbox(sandbox);
  const approval = effectiveApprovalPolicy(events);
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const allowN = runtime.pathAllowlist.count(sessionId);
  const planOn = foldPlanMode(events);
  const tools = runtime.tools?.list() ?? [];
  const counts = countExposures(tools);
  const expanded = runtime.toolDisclosure.count(sessionId);

  const cwd = resolveSessionCwd(runtime, sessionId);
  const lines = [
    `permission: ${permission} (path=${pathMode}) · approval=${approval}`,
    `permission_brief: ${permissionBrief(permission)}`,
    `tool_surface: ${toolSurfaceSummary(badge)}`,
    `surface_brief: ${surfaceBrief(badge)}`,
    `cwd: ${cwd}`,
    `path_allowlist: ${allowN} objects (session+settings)`,
    `tools: direct=${counts.direct} deferred=${counts.deferred} expanded=${expanded}`,
  ];
  if (planOn) lines.push("plan: on");
  return lines.join("\n");
}

export function createSessionCapabilityFragmentProvider(runtime: FaceRuntime): {
  readonly id: "session-capability";
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
    id: "session-capability",
    phases: ["turn-start"],
    produce({ sessionId }) {
      const value = formatSessionCapability(runtime, sessionId);
      if (!value) return [];
      return [
        {
          id: "additional_context.session_capability",
          kind: "additional_context",
          text: `<session_capability>\n${value}\n</session_capability>`,
          phase: "turn-start",
          // Ahead of collab board (8) so the self-snapshot is seen first.
          priority: 9,
        },
      ];
    },
  };
}
