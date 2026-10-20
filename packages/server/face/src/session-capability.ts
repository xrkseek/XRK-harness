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
  shouldConfineSandbox,
} from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import {
  FACE_PERMISSION_TABLE,
  formatPermissionStatusLabel,
  permissionSelectFromEvents,
  resolvePermissionPresetSpec,
} from "./permissions.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveAgentPresetProfile } from "./presets-catalog.js";
import { countExposures } from "@xrkseek/core-tools";
import { resolveSessionCwd } from "./session-cwd.js";
import { roleCapsHint, roleDeniedTools } from "./agent-team-roles.js";
import { DELEGATED_INHERIT_DENY } from "./agent-roster-store.js";
import {
  formatMemberPackInventoryLines,
  listMemberPackInventory,
} from "./agent-member-pack.js";

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

/**
 * One-line tool-surface brief. Orchestrators: kind only — verbs live in
 * `<session_posture>`. Coding: what this badge can/cannot do (no skill essays).
 */
function surfaceBrief(badge: string): string {
  switch (badge) {
    case "minimal":
      return "kind=coding_parent · fs/skill/std only — no workspace/thread peers; load skills for playbooks.";
    case "shell":
      return "kind=coding_parent · fs+bash+PTY — no web/lsp/subagents/peers.";
    case "frugal":
      return "kind=coding_parent · full tools + peers · no subagents — one session; xrk-plan-build for large work.";
    case "shallow":
      return "kind=coding_parent · full tools + subagents + peers — spawn when parallel helps (per-model live session cap).";
    case "harness":
      return "kind=coding_parent · full tools + subagents + peers — prefer team_list member_id; mint 干员→skill xrk-delegate (per-model live session cap).";
    case "im":
      return "kind=orchestrator · surface=im — verbs in <session_posture>.";
    case "qichuang":
      return "kind=orchestrator · surface=qichuang · path=open (fs incl. grep/glob) — verbs in <session_posture>.";
    default:
      return `kind=coding_parent · surface=${badge} — catalog is truth.`;
  }
}

function toolSurfaceSummary(badge: string): string {
  // Orchestration badges: fs bits alone mislead — call out the real surface.
  if (badge === "im") {
    return "im (full-access · channel+list/create/session_prompt+subagent→coding+thread_message)";
  }
  if (badge === "qichuang") {
    return "qichuang (full-access · settings+team_*+list/create/session_prompt+thread · no nested subagents)";
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
 * Live 公文包 (briefcase) inventory for an advanced member child (pack ≠ cwd).
 */
function advancedBriefcaseCapabilityLines(
  runtime: FaceRuntime,
  memberId: string,
): string[] {
  const home = runtime.agentRoster.findHome(memberId);
  if (!home) return [];
  const member = runtime.agentRoster.get(home.rosterWorkspaceId, memberId);
  if (member?.kind !== "advanced") return [];
  const productHome = runtime.agentRoster.home;
  const inv = listMemberPackInventory({
    rosterWorkspaceId: home.rosterWorkspaceId,
    memberId,
    ...(productHome ? { productHome } : {}),
  });
  if (!inv) return [];
  return [
    ...formatMemberPackInventoryLines(inv),
    "skills also in skill catalog (load by name; references/ under each skill path)",
  ];
}

/** Short capability for tool-delegated children (not UI forks). */
function formatDelegatedCapability(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  const link = runtime.subagents.getByChild(sessionId);
  if (!link || link.mode === "fork") return "";
  const role = link.role && link.role !== "default" ? link.role : "default";
  const cwd = resolveSessionCwd(runtime, sessionId);
  const humanFace = runtime.subagents.humanFacingSessionId(sessionId);
  const briefcase = link.memberId
    ? advancedBriefcaseCapabilityLines(runtime, link.memberId)
    : [];
  const lines = [
    "kind: delegated_child",
    `parent: ${link.parentSessionId}`,
    `you: ${sessionId}`,
    `human_face: ${humanFace}`,
    `role: ${role}`,
    `caps: ${roleCapsHint(link.role)}`,
    `cwd: ${cwd}`,
    ...briefcase,
    ...(link.memberId ? [`member_id: ${link.memberId}`] : []),
    ...(link.label.trim() ? [`label: ${link.label.trim()}`] : []),
    "brief: FINAL→parent (only visible result; include hard failures). ask→human_face. siblings→thread_message. catalog=truth. no self-spawn unless tasked.",
    `omitted: ${omittedChildTools(link.role)}`,
    ...childGapLines(runtime, sessionId),
  ];
  return lines.join("\n");
}

function omittedChildTools(role: Parameters<typeof roleDeniedTools>[0]): string {
  const names = new Set<string>([
    ...roleDeniedTools(role),
    ...DELEGATED_INHERIT_DENY,
  ]);
  return [...names].sort().join(",");
}

function childGapLines(runtime: FaceRuntime, sessionId: string): string[] {
  const kids = runtime.subagents.listDelegated(sessionId);
  if (kids.length === 0) return [];
  return kids.map((link) => {
    const role = link.role && link.role !== "default" ? link.role : "default";
    const who = link.label.trim() || link.childSessionId;
    return `child_gap: ${who} · ${role} · ${roleCapsHint(link.role)} · omitted=${omittedChildTools(link.role)}`;
  });
}

/**
 * Compact machine-readable capability block + brief lines.
 * Parents / forks: permission × tool_surface. Delegated children: kind=delegated_child.
 */
export function formatSessionCapability(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  const delegated = formatDelegatedCapability(runtime, sessionId);
  if (delegated) return delegated;

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
  const shellConfine = shouldConfineSandbox(sandbox) ? "on" : "off";
  const lines = [
    `badge: ${badge}`,
    `permission: ${permission} (path=${pathMode}) · approval=${approval} · shell_confine=${shellConfine}`,
    `permission_label: ${formatPermissionStatusLabel(permission)}`,
    `permission_brief: ${permissionBrief(permission)}`,
    `tool_surface: ${toolSurfaceSummary(badge)}`,
    `surface_brief: ${surfaceBrief(badge)}`,
    `cwd: ${cwd}`,
    `path_allowlist: ${allowN} objects (session+settings)`,
    `tools: direct=${counts.direct} deferred=${counts.deferred} expanded=${expanded}`,
  ];
  if (planOn) lines.push("plan: on");
  lines.push(...childGapLines(runtime, sessionId));
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
