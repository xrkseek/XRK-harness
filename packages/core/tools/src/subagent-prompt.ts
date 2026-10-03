/**
 * Model-facing subagent routing (injected when tools are bound).
 * Details live on the tool schemas; this section only steers when to use them.
 */

export const SUBAGENT_ROUTING_PROMPT_TEXT = [
  "Subagents:",
  "- Use `subagent` for a self-contained task that should not consume this conversation's context.",
  "- The child shares this session's workspace (same cwd / AGENTS inject) unless you set `worktree: true`. Do not assume it is a different project.",
  "- The child cannot see this transcript unless `inherit_context: true` (then only completed turns; the open turn is excluded). Put paths, goals, constraints, and any persona in `prompt`. Face prepends parent/child session ids, mode, role, and cwd — never tell the child to read AGENTS.md to discover who it is.",
  "- Pick the spawn shape:",
  "  - Foreground one-shot (default): wait for the answer. The child is read-only afterward — no human follow-ups.",
  "  - Background continuable (`run_in_background: true`): chat companion or long task. Continue with `followup_task` (new task + turn) / `send_message` (queue; delivery=steer only for a mid-turn nudge) / `wait_agent` / `interrupt_agent`.",
  "  - Need this conversation: `inherit_context: true` (in-process only).",
  "  - Isolated git tree: `worktree: true` (same repo, separate checkout).",
  "  - Specialist: `role` worker | researcher | reviewer | lead. A companion persona still belongs in `prompt`, not in role/AGENTS.md.",
  "- `team_graph` reads/edits the collaboration graph (delegates + peer): view · neighbors · link/unlink · role · announce to peers.",
  "- `wait_agent` blocks until listed children are idle (or timeout) and returns their last answer — prefer longer timeouts over tight loops.",
  "- `analytics` shows depth/active quota and per-child queue/steer backlog before spawning more work.",
  "- Default `runtime` is in-process (Face child). Set `runtime` to `acp` / `app-server` / `claude-code` for an external subprocess (needs local binary / Settings). `acp` / `app-server` support `run_in_background` + the same followup/wait/interrupt tools; `claude-code` stays one-shot print.",
  "- Use `ralph` only when the human explicitly asks for a Ralph / fresh-agent loop toward one immutable objective (each round is a new child; handoff is structured JSON). Prefer `subagent` for ordinary delegation.",
  "- Prefer a few independent children over deep nesting; respect depth and active-child caps. Prefer doing small work yourself — **Frugal** has no subagent tools; **Shallow** allows depth 1 only.",
].join("\n");
