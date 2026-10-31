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
      "ROLE: worker. Execute the assigned task precisely. Prefer concrete edits and evidence over planning. Ask only when blocked. " +
      "You are not the only agent editing this codebase: stay inside the scope you were given and never revert another agent's or the user's changes. " +
      "Nested subagent is allowed when parallel slices help; FINAL still reports to your parent (干员→干员).",
    // Keep write/shell; allow nested `subagent` (agent-home + L1 children).
    // `ralph` / `team_graph` stay lead/orchestrator-facing.
    deniedTools: ["ralph", "team_graph"],
  },
  researcher: {
    id: "researcher",
    reminder:
      "ROLE: researcher. Gather facts with read/search/web tools. Prefer citations (paths · symbols · quotes · URLs). Do not make durable edits unless the task explicitly requires them. " +
      "If a required tool is missing or returns a hard capability error, report that blocker with evidence in your FINAL message to the parent.",
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
      "interrupt_agent",
      "close_agent",
      "wait_agent",
      "list_agents",
      "analytics",
    ],
  },
  reviewer: {
    id: "reviewer",
    reminder:
      "ROLE: reviewer. Critique risks, regressions, and missing tests. Prefer findings with severity and file references. Do not implement fixes unless asked.",
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
      "interrupt_agent",
      "close_agent",
      "wait_agent",
      "list_agents",
      "analytics",
    ],
  },
  lead: {
    id: "lead",
    reminder:
      "ROLE: lead. Break work into clear sub-tasks, coordinate teammates, and keep a short status of blockers and next steps. Delegate when a specialist role fits.",
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
      ? "one-shot (no later human follow-ups on this session)"
      : "continuable (parent may send followup_task / send_message)";
  const inheritLine = input.inheritContext
    ? "yes — seeded completed parent turns only (the parent's open turn is not included)"
    : "no — you cannot see the parent transcript. Do not invent parent state.";
  const workspaceLine = input.isolatedWorktree
    ? "isolated git worktree (not the parent's checkout). Follow the worktree note in the task."
    : "same as the parent session. File tools and git run here.";
  const packHome = input.packHome?.trim();
  const packMaterials = input.packMaterials?.trim();
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
    ...(input.packInventoryLines && input.packInventoryLines.length > 0
      ? input.packInventoryLines.map((line) => `- ${line}`)
      : packHome
        ? [
            `- 公文包 (briefcase): ${packHome} · not workspace cwd — read/edit or copy into workspace`,
            `- skills_dir: ${path.join(packHome, "skills")} · load via skill tool/catalog (no per-skill path dump)`,
            ...(packMaterials
              ? [`- materials: ${packMaterials} · 公文包/briefcase workspace/`]
              : []),
          ]
        : []),
    "Delivery: FINAL assistant message is the only thing the parent sees (not reasoning, not intermediate tool output). Lead with the answer, then evidence. Hard tool/capability failures go in that message. Finish in-scope work; do not bounce ordinary steps, do not end with 'let me know', and do not spawn unless the task says so. Home standing (~/.xrk) is skipped — cwd workspace AGENTS.md (member playbook when present) + <seat_identity> are your seat; do not treat a parent-repo root AGENTS.md as identity theater.",
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
