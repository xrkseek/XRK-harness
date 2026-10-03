/**
 * Spawn-time role templates for Agent Teams (Codex agent_type · Hermes leaf/orchestrator).
 * Graph `delegator|worker|observer` stays a UI label; these prefix the child prompt.
 */

import {
  flattenText,
  isHumanUserMessageSource,
  type MessageContent,
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
      "You are not the only agent editing this codebase: stay inside the scope you were given and never revert another agent's or the user's changes.",
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
  /** Bounded root-evidence block (see {@link rootUserAuthorizationBlock}). */
  readonly userAuthorization?: string;
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
  const header = [
    "[subagent identity]",
    `You are a delegated subagent of parent session \`${input.parentSessionId}\`. You are not that parent conversation.`,
    `- parent_session_id: ${input.parentSessionId}`,
    `- your_session_id: ${input.childSessionId}`,
    `- mode: ${modeLine}`,
    `- label: ${input.label.trim() || "subagent"}`,
    `- role: ${role}`,
    `- inherit_context: ${inheritLine}`,
    `- workspace_cwd: ${input.cwd}`,
    `- workspace: ${workspaceLine}`,
    "Delivery: your FINAL assistant message is the result handed back to the parent as a tool result — it is the only thing the parent sees from you.",
    "The parent cannot see your hidden reasoning, intermediate tool output, or this conversation. Anything the parent needs must be in your final message.",
    "Write that message as a standalone deliverable: lead with the answer or the findings, then the evidence (paths · symbols · quotes · commands). Do not ask the user questions and do not end with 'let me know if you need more'.",
    "Do not treat repository AGENTS.md / .agents/AGENTS.md as your persona or as proof of who you are, and do not defer small tasks back to the parent — you were spawned to do this work, not to plan it.",
    "Never spawn your own subagents unless the task explicitly requires it.",
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
    const text = flattenText(ev.content as MessageContent).trim();
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
