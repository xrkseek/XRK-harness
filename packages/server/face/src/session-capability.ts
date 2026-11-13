/**
 * Turn-start `<session_capability>` — permission × tool-surface snapshot
 * plus short briefs. Standing AGENTS stays common; this fragment is the
 * per-session axes. Orthogonal to collab board / session_posture.
 */

import { readSessionEvents } from "@xrkseek/core-session";
import {
  effectiveApprovalPolicy,
  effectiveSandboxMode,
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
  resolveMemberPackForSession,
} from "./agent-member-pack.js";

import { subagentDepth } from "./subagent-tools.js";
import { liveRouteAllowsImageInput } from "./llm-resolve.js";
import { resolveSessionModelSelection } from "./model-catalog.js";
import { sessionSeatMemberId } from "./agent-home-boundary.js";

/** Live provider/model and image modality for this session, one line each. */
export function formatSessionModelRouteLines(
  runtime: FaceRuntime,
  sessionId: string,
): string[] {
  const selection = resolveSessionModelSelection(runtime, sessionId);
  const provider = selection.provider.trim();
  const model = selection.model.trim();
  const route =
    provider && model
      ? `${provider}/${model}`
      : provider
        ? `${provider}/(unset)`
        : model
          ? `(unset)/${model}`
          : "(unset)";
  const multimodal = liveRouteAllowsImageInput(runtime, sessionId);
  return [
    `model: ${route}`,
    multimodal
      ? "modality: multimodal"
      : "modality: text-only (no images; switch model for vision)",
  ];
}

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
      return "kind=coding_parent · PI · fs+session only — no bash/skill/web/office/peer/subagents.";
    case "shell":
      return "kind=coding_parent · Shell · fs+session+bash+skill+PTY — no web/office/peer/subagents.";
    case "frugal":
      return "kind=coding_parent · Frugal · local+web+office · no peer/subagents — one session; outline→ask→todo→build.";
    case "shallow":
      return "kind=coding_parent · Shallow · Frugal+peer+subagents — spawn when parallel helps (cap 2).";
    case "harness":
      return "kind=coding_parent · Harness · full peer+subagents — prefer team_list member_id (live session cap).";
    case "im":
      return "kind=orchestrator · surface=im — verbs in <session_posture>.";
    case "qichuang":
      return "kind=orchestrator · surface=qichuang · path=open — verbs in <session_posture>.";
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
    return "qichuang (full-access · settings+team_*+web+lsp+pty+list/create/session_prompt+thread · mcp_config · no nested subagent)";
  }
  const profile = resolveAgentPresetProfile(badge);
  const bits: string[] = ["fs", "session"];
  if (profile.tools.bash) bits.push("bash");
  if (profile.tools.skill) bits.push("skill");
  if (profile.tools.web) bits.push("web");
  if (profile.tools.lsp) bits.push("lsp");
  if (profile.tools.pty) bits.push("pty");
  if (profile.tools.office) bits.push("office");
  if (badge === "shallow" || badge === "harness") bits.push("peer");
  const sub =
    profile.subagents.mode === "off"
      ? "subagents=off"
      : `subagents=${profile.delegation}`;
  return `${badge} (${bits.join("+")} · ${sub})`;
}

/**
 * 公文包 (briefcase) lines for whoever is wearing this member — identical in
 * both lanes. A 干员 is the same employee whether it sits in its own office
 * (the boss is its speaker) or was dispatched (someone else is): same pack,
 * same materials, same skills. What differs is the tool surface and who
 * answers `ask`, and both of those are derived elsewhere from live facts
 * (role floor / child link) — never by trimming the briefcase.
 */
function briefcaseLines(runtime: FaceRuntime, memberId: string): string[] {
  const inv = resolveMemberPackForSession(
    {
      findHome: (id) => runtime.agentRoster.findHome(id),
      isAdvanced: (rosterWorkspaceId, id) =>
        runtime.agentRoster.get(rosterWorkspaceId, id)?.kind === "advanced",
      productHome: runtime.agentRoster.home,
    },
    memberId,
  );
  return inv ? formatMemberPackInventoryLines(inv) : [];
}



/**
 * Who answers this seat's questions, and whose words it is acting on.
 *
 * Both lanes are the same employee; what differs is the seat's speaker. The
 * answer channel follows the speaker — never hardcode ask_user / ask_parent
 * per lane, or the two drift (a dispatched 干员 that never learns its ask goes
 * to its dispatcher instead of the boss).
 */
/** Seat ask routing — one short line; tool dynamicSchema carries live extras. */
function seatSpeakerLines(
  runtime: FaceRuntime,
  sessionId: string,
): string[] {
  const link = runtime.subagents.getByChild(sessionId);
  if (link && link.mode !== "fork") {
    return [`ask: ask→${link.parentSessionId} (answer_ask; not boss)`];
  }
  return ["ask: ask_user→boss"];
}

/**
 * Runtime MCP: global + session workspace (+ agent-home when seated member
 * has a distinct home overlay). Config/mutate stays on 奇创.
 */
function mcpMountLines(
  runtime: FaceRuntime,
  sessionId: string,
): string[] {
  const wsId = runtime.workspaces.workspaceIdOf(sessionId);
  const memberId = sessionSeatMemberId(runtime, sessionId);
  const home = memberId
    ? runtime.workspaces.findAgentHomeByMember(memberId)
    : undefined;
  const homeId = home?.workspaceId;
  const parts = ["global"];
  if (wsId) parts.push(`ws:${wsId}`);
  if (homeId && homeId !== wsId) parts.push(`home:${homeId}`);
  return [`mcp_mount: ${parts.join("+")}`];
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
    ? briefcaseLines(runtime, link.memberId)
    : [];
  const depth = subagentDepth(runtime, sessionId);
  const nestBrief =
    depth <= 1
      ? "L1 — FINAL→parent; identity = playbook + seat_identity."
      : `L${depth} — stay narrow; FINAL one parent at a time; no manager standing.`;
  const lines = [
    "kind: delegated_child",
    `parent: ${link.parentSessionId}`,
    `you: ${sessionId}`,
    `human_face: ${humanFace}`,
    `depth: ${depth}`,
    `role: ${role}`,
    `caps: ${roleCapsHint(link.role)}`,
    ...formatSessionModelRouteLines(runtime, sessionId),
    `cwd: ${cwd}`,
    ...briefcase,
    ...(link.memberId ? [`member_id: ${link.memberId}`] : []),
    ...(link.label.trim() ? [`label: ${link.label.trim()}`] : []),
    `brief: ${nestBrief} siblings→thread_message. catalog=truth.` +
      (roleDeniedTools(link.role).includes("subagent")
        ? " no nested subagent."
        : " nested subagent ok."),
    `omitted: ${omittedChildTools(link.role)}`,
    ...mcpMountLines(runtime, sessionId),
    ...seatSpeakerLines(runtime, sessionId),
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
  const tools = runtime.tools?.list() ?? [];
  const counts = countExposures(tools);
  const expanded = runtime.toolDisclosure.count(sessionId);

  const cwd = resolveSessionCwd(runtime, sessionId);
  // Identity sessions (干员 agent-home) wear the same member as a dispatched
  // child, so they get the same briefcase lines: cwd is the bare agent-home,
  // and without a pointer the member hunts the filesystem for materials it
  // already owns.
  const identity = runtime.sessionIdentities.get(sessionId);
  const briefcase = identity?.memberId
    ? briefcaseLines(runtime, identity.memberId)
    : [];
  const shellConfine = shouldConfineSandbox(sandbox) ? "on" : "off";
  const pendingAsks = runtime.parentAsk.listPending(sessionId);
  const lines = [
    `badge: ${badge}`,
    `permission: ${permission} (path=${pathMode}) · approval=${approval} · shell_confine=${shellConfine}`,
    `permission_label: ${formatPermissionStatusLabel(permission)}`,
    `permission_brief: ${permissionBrief(permission)}`,
    `tool_surface: ${toolSurfaceSummary(badge)}`,
    `surface_brief: ${surfaceBrief(badge)}`,
    ...formatSessionModelRouteLines(runtime, sessionId),
    `cwd: ${cwd}`,
    ...briefcase,
    ...(identity?.memberId ? [`member_id: ${identity.memberId}`] : []),
    ...mcpMountLines(runtime, sessionId),
    ...seatSpeakerLines(runtime, sessionId),
    // Only when live — answer_ask dynamicSchema also lists these.
    ...(pendingAsks.length > 0
      ? [
          `child_ask_pending: ${pendingAsks
            .map((p) => {
              const who = p.childLabel.trim() || p.childSessionId;
              return `${p.askId}←${who}`;
            })
            .join(",")}`,
        ]
      : []),
    `path_allowlist: ${allowN} objects (session+settings)`,
    `tools: direct=${counts.direct} deferred=${counts.deferred} expanded=${expanded}`,
  ];
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
