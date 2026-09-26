/**
 * Model-facing subagent routing (injected when tools are bound).
 * Details live on the tool schemas; this section only steers when to use them.
 */

export const SUBAGENT_ROUTING_PROMPT_TEXT = [
  "Subagents:",
  "- Use `subagent` for a self-contained task that should not consume this conversation's context. The child cannot see this transcript — put paths, goals, and constraints in `prompt`.",
  "- Default waits for the result. `run_in_background: true` returns a durable child id; continue with `followup_task` (wake a turn) / `send_message` (queue without forcing a turn) / `wait_agent` / `interrupt_agent` / `list_agents` / `analytics` / `team_graph` (do not busy-poll).",
  "- `team_graph` reads/edits the collaboration graph (delegates + peer): view · neighbors · link/unlink · role · announce to peers.",
  "- `followup_task` = new task + trigger turn (Codex TriggerTurn). `send_message` defaults to queue; set delivery=steer only when you need a mid-turn nudge.",
  "- `wait_agent` blocks until listed children are idle (or timeout) and returns their last answer — prefer longer timeouts over tight loops.",
  "- `analytics` shows depth/active quota and per-child queue/steer backlog before spawning more work.",
  "- Default `runtime` is in-process (Face child). Set `runtime` to `acp` / `app-server` / `claude-code` for an external subprocess (needs local binary / Settings). `acp` / `app-server` support `run_in_background` + the same followup/wait/interrupt tools; `claude-code` stays one-shot print.",
  "- Use `ralph` only when the human explicitly asks for a Ralph / fresh-agent loop toward one immutable objective (each round is a new child; handoff is structured JSON). Prefer `subagent` for ordinary delegation.",
  "- Prefer a few independent children over deep nesting; respect depth and active-child caps. Prefer doing small work yourself — **Frugal** has no subagent tools; **Shallow** allows depth 1 only.",
].join("\n");
