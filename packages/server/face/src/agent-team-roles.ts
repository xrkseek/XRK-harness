/**
 * Spawn-time role templates for Agent Teams (Codex agent_type · Hermes leaf/orchestrator).
 * Graph `delegator|worker|observer` stays a UI label; these prefix the child prompt.
 */

import path from "node:path";
import {
  flattenText,
  isHumanUserMessageSource,
  type SessionEvent,
} from "@xrkseek/protocol";
import { MEMBER_PACK_BRIEFCASE } from "./agent-member-pack.js";

export type AgentTeamSpawnRole =
  | "default"
  | "worker"
  | "researcher"
  | "reviewer"
  | "lead";

export const AGENT_TEAM_SPAWN_ROLES: readonly AgentTeamSpawnRole[] = [
  "default",
  "worker",
  "researcher",
  "reviewer",
  "lead",
];

export function isAgentTeamSpawnRole(
  value: unknown,
): value is AgentTeamSpawnRole {
  return (
    value === "default" ||
    value === "worker" ||
    value === "researcher" ||
    value === "reviewer" ||
    value === "lead"
  );
}

interface RoleTemplate {
  readonly id: AgentTeamSpawnRole;
  /** Short reminder prepended to the child prompt. */
  readonly reminder: string;
  /**
   * Tools this role may never call. **Deny-only** (mirrors Codex `role.rs`:
   * a role may customize or weaken a subagent, never strengthen it). Applied
   * at Agent-handle build time in Host `resolveAgent`; without it a reviewer
   * would still hold write/bash/web tools and "do not edit" is just a prompt.
   */
  readonly deniedTools?: readonly string[];
}

const TEMPLATES: Readonly<Record<AgentTeamSpawnRole, RoleTemplate>> = {
  default: {
    id: "default",
    reminder: "",
  },
  worker: {
    id: "worker",
    reminder:
      "ROLE: worker. Precise edits + evidence; ask only when blocked. " +
      "Stay in scope — never revert another agent's or the user's changes. " +
      "Nested subagent ok when parallel helps; FINAL still → parent.",
    // Keep write/shell; allow nested `subagent` (agent-home + L1 children).
    // `ralph` / `team_graph` stay lead/orchestrator-facing.
    deniedTools: ["ralph", "team_graph"],
  },
  researcher: {
    id: "researcher",
    reminder:
      "ROLE: researcher. Read/search/web; cite paths · symbols · quotes · URLs. No durable edits unless tasked. " +
      "Missing/hard tool error → FINAL to parent with evidence.",
    // Read-only by construction: no edits, no shell, no delegation.
    // Browser/MCP stay available when the parent session has them (user may deny via member tools).
    deniedTools: [
      "apply_edit",
      "apply_patch",
      "write_file",
      "bash",
      "terminal_open",
      "terminal_send",
      "terminal_read",
      "terminal_list",
      "terminal_close",
      "terminal_signal",
      "subagent",
      "ralph",
      "team_graph",
      "send_message",
      "followup_task",
      "set_agent_model",
      "list_models",
      "interrupt_agent",
      "close_agent",
      "wait_agent",
      "list_agents",
    ],
  },
  reviewer: {
    id: "reviewer",
    reminder:
      "ROLE: reviewer. Risks / regressions / missing tests — findings with severity + paths. No fixes unless asked.",
    // Review must never mutate: no writes, no shell, no network (offline
    // evidence only), no delegation, no self-spawn.
    deniedTools: [
      "apply_edit",
      "apply_patch",
      "write_file",
      "bash",
      "terminal_open",
      "terminal_send",
      "terminal_read",
      "terminal_list",
      "terminal_close",
      "terminal_signal",
      "web_search",
      "web_fetch",
      "browser_open",
      "browser_act",
      "browser_snapshot",
      "browser_vision",
      "browser_scroll",
      "browser_vault_list",
      "browser_vault_fill",
      "mcp__playwright*",
      "subagent",
      "ralph",
      "team_graph",
      "send_message",
      "followup_task",
      "set_agent_model",
      "list_models",
      "interrupt_agent",
      "close_agent",
      "wait_agent",
      "list_agents",
    ],
  },
  lead: {
    id: "lead",
    reminder:
      "ROLE: lead. Break work, coordinate teammates, track blockers/next. Delegate when a specialist fits.",
  },
};

/** Resolve a spawn role string (aliases: agent_type · role). Unknown → undefined. */
export function parseAgentTeamSpawnRole(
  value: unknown,
): AgentTeamSpawnRole | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "agent" || raw === "default") return "default";
  if (isAgentTeamSpawnRole(raw)) return raw;
  return undefined;
}

/** Prepend the role reminder when non-empty. */
export function applySpawnRoleReminder(
  prompt: string,
  role: AgentTeamSpawnRole | undefined,
): string {
  if (!role || role === "default") return prompt;
  const reminder = TEMPLATES[role].reminder.trim();
  if (!reminder) return prompt;
  const body = prompt.trim();
  return body ? `${reminder}\n\n${body}` : reminder;
}

export interface SubagentSpawnPreambleInput {
  readonly prompt: string;
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly mode: "one-shot" | "continuable";
  readonly label: string;
  readonly role?: AgentTeamSpawnRole;
  readonly inheritContext: boolean;
  readonly cwd: string;
  readonly isolatedWorktree: boolean;
  /**
   * Absolute path to an advanced member's 公文包 (briefcase) / pack home.
   * Session cwd stays the parent workspace; child may read/write/copy from here.
   */
  readonly packHome?: string;
  /** Pack `workspace/` materials when present (still under 公文包/briefcase). */
  readonly packMaterials?: string;
  /** Optional live inventory lines (skills + references paths). */
  readonly packInventoryLines?: readonly string[];
  /** Bounded root-evidence block (see {@link rootUserAuthorizationBlock}). */
  readonly userAuthorization?: string;
  /** Named 干员 this child was spawned as. */
  readonly memberId?: string;
  /** Inject thickness from the 干员 record. */
  readonly inject?: "subagent" | "minimal";
  /**
   * Parent permission snapshot (sandbox / pathAccessMode / approval).
   * Example: `workspace-write (path=allowlisted) · approval=ask`
   */
  readonly permissionInherit?: string;
  /** Parent tool-surface badge id (child tools are weakened from this). */
  readonly parentToolSurface?: string;
}

/** Short caps hint for spawn preamble (deny-floor roles). */
export function roleCapsHint(role: AgentTeamSpawnRole | undefined): string {
  switch (role) {
    case "researcher":
      return "web,read-fs";
    case "reviewer":
      return "read-fs";
    case "worker":
      return "edit,shell,read-fs,subagent";
    case "lead":
      return "orchestrate";
    default:
      return "parent-tools";
  }
}

/**
 * 公文包 lines for the spawn preamble — same wording as the identity lane
 * (both call {@link formatMemberPackInventoryLines}). Callers pass the live
 * inventory lines when they have them, else the paths; this never invents a
 * second phrasing or trims the pack to "fit a task".
 */
function briefcasePreambles(input: SubagentSpawnPreambleInput): readonly string[] {
  // Live inventory lines win — they are the only source that can tell the
  // truth about how many skills the pack has.
  if (input.packInventoryLines && input.packInventoryLines.length > 0) {
    return input.packInventoryLines;
  }
  const packHome = input.packHome?.trim();
  if (!packHome) return [];
  // Paths only: say nothing about skills we did not enumerate. Claiming
  // "(none yet)" here would actively mislead a 干员 that does have skills.
  const lines = [
    `${MEMBER_PACK_BRIEFCASE}: not workspace cwd — read/edit here or copy into workspace`,
    `pack_home: ${packHome}`,
    `skills_dir: ${path.join(packHome, "skills")}`,
  ];
  const packMaterials = input.packMaterials?.trim();
  if (packMaterials) lines.push(`materials: ${packMaterials}`);
  return lines;
}

/**
 * Identity block every in-process child sees before the parent-written task.
 * Covers parent/child session ids, mode, role, workspace cwd, and whether
 * the parent transcript was seeded — so the child does not guess from AGENTS.md.
 */
export function applySubagentSpawnPreamble(
  input: SubagentSpawnPreambleInput,
): string {
  const role = input.role && input.role !== "default" ? input.role : "default";
  const modeLine =
    input.mode === "one-shot"
      ? "one-shot (no later human follow-ups)"
      : "continuable (parent may followup_task / send_message)";
  const inheritLine = input.inheritContext
    ? "yes — completed parent turns only (open turn excluded)"
    : "no — no parent transcript; do not invent parent state";
  const workspaceLine = input.isolatedWorktree
    ? "isolated git worktree (not parent's checkout) — follow the task's worktree note"
    : "same as the parent session — fs/git here";
  const packLines = briefcasePreambles(input);
  // Identity + delivery only. Live axes (ask, omitted tools, siblings) live in
  // turn-start <session_capability> — do not re-lecture them here.
  const header = [
    "[subagent identity]",
    `Delegated child of \`${input.parentSessionId}\` (you=\`${input.childSessionId}\`).`,
    `- mode: ${modeLine}`,
    `- label: ${input.label.trim() || "subagent"}`,
    `- role: ${role}`,
    ...(input.memberId
      ? [
          `- member_id: ${input.memberId}`,
          `- inject: ${input.inject === "subagent" ? "subagent" : "minimal"}`,
        ]
      : []),
    ...(input.permissionInherit
      ? [`- permission: ${input.permissionInherit}`]
      : []),
    ...(input.parentToolSurface
      ? [
          `- tool_surface: badge=${input.parentToolSurface} · role=${role} · caps=${roleCapsHint(input.role)}`,
        ]
      : []),
    `- inherit_context: ${inheritLine}`,
    `- workspace: ${input.cwd} · ${workspaceLine}`,
    ...packLines.map((line) => `- ${line}`),
    "Delivery: FINAL assistant message only reaches parent (not reasoning / mid-tool). Answer→evidence; hard fails there. Finish in-scope — no bounce, no 'let me know'; spawn only if tasked. Seat = cwd AGENTS.md (+ playbook) + <seat_identity>; ~/.xrk standing skipped; parent-repo root AGENTS.md ≠ identity.",
  ].join("\n");
  const tasked = applySpawnRoleReminder(input.prompt, input.role);
  const body = tasked.trim();
  const authorization = input.userAuthorization?.trim();
  const head = authorization ? `${header}\n\n${authorization}` : header;
  return body ? `${head}\n\nTask:\n${body}` : head;
}

export function listSpawnRoleIds(): readonly AgentTeamSpawnRole[] {
  return AGENT_TEAM_SPAWN_ROLES;
}

/**
 * Full roster mint/install/uninstall stay on the parent.
 * Children with member_id get `team_self` (own playbook) instead — not these.
 */
const ROSTER_EDIT_DENY = [
  "team_save",
  "team_import",
  "team_ready",
  "team_export",
  "team_remove",
] as const;

/** Tools denied for one role. Default / lead have no extra floor besides roster edits. */
export function roleDeniedTools(
  role: AgentTeamSpawnRole | undefined,
): readonly string[] {
  const base =
    !role || role === "default" || role === "lead"
      ? []
      : (TEMPLATES[role].deniedTools ?? []);
  return [...base, ...ROSTER_EDIT_DENY];
}

/** Bounded root-evidence ceiling (mirrors Codex `MAX_ROOT_MESSAGES`). */
const MAX_USER_AUTHORIZATION_MESSAGES = 4;
/** Per-message text cap, so one long paste cannot crowd out the rest. */
const MAX_USER_AUTHORIZATION_CHARS = 600;

/**
 * The human's own recent asks from the parent conversation — the child's only
 * view of what the user actually authorized.
 *
 * Codex does this in `control/user_authorization.rs` (bounded retained root
 * evidence for workers, including after compaction). A child spawned with
 * `inherit_context:false` otherwise sees only the parent's paraphrase of the
 * request, which is how "the subagent did something the user never asked for"
 * happens. These are evidence, not instructions: the parent's task text still
 * wins on conflict.
 *
 * Only real human messages count (`isHumanUserMessageSource` filters out
 * durable context injects such as the skill catalog), and only ones newer than
 * a seeded fork (a forked child already carries them in its own transcript).
 */
export function rootUserAuthorizationBlock(input: {
  readonly parentEvents: readonly SessionEvent[];
  /** Seed cut of a forked child: anything before it is already in its log. */
  readonly sinceEventCount?: number;
}): string | undefined {
  const since = input.sinceEventCount ?? 0;
  const out: string[] = [];
  for (let i = input.parentEvents.length - 1; i >= since; i -= 1) {
    const ev = input.parentEvents[i]!;
    if (ev.type !== "user/message") continue;
    if (!isHumanUserMessageSource(ev.source)) continue;
    const text = flattenText(ev.content).trim();
    if (!text) continue;
    out.push(
      text.length > MAX_USER_AUTHORIZATION_CHARS
        ? `${text.slice(0, MAX_USER_AUTHORIZATION_CHARS)}…`
        : text,
    );
    if (out.length >= MAX_USER_AUTHORIZATION_MESSAGES) break;
  }
  if (out.length === 0) return undefined;
  // Oldest first so the chronology reads naturally.
  out.reverse();
  return [
    "[what the user asked for]",
    "Recent messages from the human in the parent conversation, oldest first. Evidence of what was authorized — the task below still wins on conflict. Do not invent requests beyond these.",
    ...out.map((text) => `- ${text.replace(/\n+/g, " ")}`),
  ].join("\n");
}
