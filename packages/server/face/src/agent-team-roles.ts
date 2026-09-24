/**
 * Spawn-time role templates for Agent Teams (Codex agent_type · Hermes leaf/orchestrator).
 * Graph `delegator|worker|observer` stays a UI label; these prefix the child prompt.
 */

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
}

const TEMPLATES: Readonly<Record<AgentTeamSpawnRole, RoleTemplate>> = {
  default: {
    id: "default",
    reminder: "",
  },
  worker: {
    id: "worker",
    reminder:
      "ROLE: worker. Execute the assigned task precisely. Prefer concrete edits and evidence over planning. Ask only when blocked.",
  },
  researcher: {
    id: "researcher",
    reminder:
      "ROLE: researcher. Gather facts with read/search tools. Prefer citations (paths · symbols · quotes). Do not make durable edits unless the task explicitly requires them.",
  },
  reviewer: {
    id: "reviewer",
    reminder:
      "ROLE: reviewer. Critique risks, regressions, and missing tests. Prefer findings with severity and file references. Do not implement fixes unless asked.",
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

export function listSpawnRoleIds(): readonly AgentTeamSpawnRole[] {
  return AGENT_TEAM_SPAWN_ROLES;
}
