/**
 * Model-facing subagent routing (injected when tools are bound).
 * Details live on the tool schemas; this section only steers when to use them.
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
      "- \"Go deeper\", \"investigate more\", or \"make it thorough\" is NOT authorization to spawn.",
      "- When delegation is justified, use `subagent` normally.",
    ].join("\n");
  }
  return [
    "Delegation: proactive.",
    "- Spawning is an approved strategy; spawn when it genuinely helps (parallel independent work, research without burning this context).",
    "- Depth, active-child, and budget caps still apply — `analytics` before fanning out.",
  ].join("\n");
}

export function subagentRoutingPrompt(
  mode: DelegationRoutingMode = "proactive",
): string {
  return [
    "Subagents:",
    "- Use `subagent` for a self-contained task that should not consume this conversation's context.",
    "- Before spawning, make a high-level plan and identify the critical path. Do NOT delegate the task you are blocked on to a child and then wait — you are the one responsible for unblocking it.",
    "- A child task must be self-contained and must not duplicate work you are already doing. Give disjoint scopes to concurrent children so two writers never edit the same file.",
    "- The child shares this session's workspace (same cwd / AGENTS inject) unless you set `worktree: true`. Do not assume it is a different project.",
    "- The child cannot see this transcript unless `inherit_context: true` (then only completed turns; the open turn is excluded). Put paths, goals, constraints, and any persona in `prompt`. Face prepends parent/child session ids, mode, role, and cwd — never tell the child to read AGENTS.md to discover who it is.",
    "- Pick the spawn shape:",
    "  - Foreground one-shot (default): wait for the answer. The child is read-only afterward — no human follow-ups.",
    "  - Background continuable (`run_in_background: true`): chat companion or long task. Continue with `followup_task` (new task + turn) / `send_message` (queue; delivery=steer only for a mid-turn nudge) / `wait_agent` / `interrupt_agent`.",
    "  - Need this conversation: `inherit_context: true` (in-process only).",
    "  - Isolated git tree: `worktree: true` (same repo, separate checkout).",
    "  - Child profile: prefer Agent Team `member_id` from the turn-start collab board (and `subagent` / `team_list`) so the child gets that member's tools, inject, and playbook. Seed AGENTS.md and skills stay on standing inject — do not paste them into the child prompt. Bare `role` worker | researcher | reviewer | lead is only the fallback. Publish a repeatable profile with `team_save` from this chat.",
    "- Match the live catalog by name and brief. If a member's job fits the user ask, `subagent` with that `member_id` this turn. Do not load their skill and do the job yourself. Tiny asks with no catalog match stay with you. `presence_set` may run in parallel.",
    "- Sibling parent sessions talk with `thread_message` (session_id from the collab board; reply comes back here). Do not `thread_switch` to send mail. That is not a subagent.",
    "- `team_graph` reads/edits the collaboration graph (delegates + peer): view · neighbors · link/unlink · role · announce to peers.",
    "- `wait_agent` blocks until listed children are idle (or timeout) and returns their last answer — prefer longer timeouts over tight loops.",
    "- `analytics` shows depth/active quota and per-child queue/steer backlog before spawning more work.",
    "- Default `runtime` is in-process (Face child). Set `runtime` to `acp` / `app-server` / `claude-code` for an external subprocess (needs local binary / Settings). `acp` / `app-server` support `run_in_background` + the same followup/wait/interrupt tools; `claude-code` stays one-shot print.",
    "- Use `ralph` only when the human explicitly asks for a Ralph / fresh-agent loop toward one immutable objective (each round is a new child; handoff is structured JSON). Prefer `subagent` for ordinary delegation.",
    "- Prefer a few independent children over deep nesting; respect depth and active-child caps. Prefer doing small work yourself **only when no catalog member fits** — **Frugal** has no subagent tools; **Shallow** allows depth 1 only.",
    delegationModeLine(mode),
  ].join("\n");
}

/** Legacy constant — keeps callers that inject the static text working. */
export const SUBAGENT_ROUTING_PROMPT_TEXT = subagentRoutingPrompt("proactive");
