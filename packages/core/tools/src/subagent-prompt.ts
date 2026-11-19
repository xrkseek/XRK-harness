/**
 * Model-facing subagent routing (injected when tools are bound).
 * Shape / delivery / route params live on tool schemas; this section only steers.
 */

export type DelegationRoutingMode = "explicit" | "proactive";

/**
 * Delegation posture — two mutually exclusive messages, one wins (Codex
 * `multi_agent.rs` EXPLICIT_REQUEST_ONLY / PROACTIVE). The mode comes from the
 * session badge's `delegation` field.
 */
export function delegationModeLine(mode: DelegationRoutingMode): string {
  if (mode === "explicit") {
    return [
      "Delegation: explicit only.",
      "- Do NOT spawn unless the user, AGENTS.md, or the task text itself asked for delegation.",
      "- \"Go deeper\" / \"investigate more\" / \"make it thorough\" is NOT authorization.",
    ].join("\n");
  }
  return [
    "Delegation: proactive.",
    "- Spawn when it genuinely helps (parallel independent work, research without burning this context).",
    "- Caps still apply — `list_agents` before fan-out.",
  ].join("\n");
}

export function subagentRoutingPrompt(
  mode: DelegationRoutingMode = "proactive",
): string {
  return [
    "Subagents:",
    "- Gate on turn-start `<session_capability>` (tool_surface · path · member caps). No subagent on Minimal/Shell/Frugal → Skill or self.",
    "- Self-contained task only; high-level plan first; never delegate the blocker you are waiting on; concurrent children get disjoint scopes.",
    "- Prefer `member_id` from collab board / `team_list`. Tiny asks with no catalog match stay with you. Peers use `thread_message` (not `thread_switch`).",
    "- Child ≤ this tool_surface + role/member; same cwd unless `worktree: true` (coding) or IM `workspace_id`/`cwd`; no transcript unless `inherit_context: true` — put the job in `prompt` (Face prepends ids; never tell the child to read AGENTS.md for identity).",
    "- Shape: continuable default (`followup_task` / `send_message` / `interrupt_agent` / `close_agent`); one-shot `run_in_background: false` only when the user asked to wait in this call; `ralph` only if the human asks.",
    "- Route defaults to this session's provider/model/effort; override on `subagent` when needed. `(QUOTA)` → `set_agent_model` / `list_models` then follow up; `(RATE_LIMIT)` wait and resend same route.",
    "- After handoff: end the turn when idle (Host steers a completion notice); `wait_agent` when this turn is blocked. Default `delivery=steer`. `team_graph` for the peer graph.",
    delegationModeLine(mode),
  ].join("\n");
}

/** Legacy constant — keeps callers that inject the static text working. */
export const SUBAGENT_ROUTING_PROMPT_TEXT = subagentRoutingPrompt("proactive");
