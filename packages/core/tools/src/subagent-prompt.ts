/**
 * Model-facing subagent routing (injected when tools are bound).
 * Details live on the tool schemas; this section only steers when to use them.
 */

export const SUBAGENT_ROUTING_PROMPT_TEXT = [
  "Subagents:",
  "- Use `subagent` for a self-contained task that should not consume this conversation's context. The child cannot see this transcript — put paths, goals, and constraints in `prompt`.",
  "- Default waits for the result. `run_in_background: true` returns a durable child id; follow up with `send_message` / `interrupt_agent` / `list_agents` (do not poll).",
  "- Prefer a few independent children over deep nesting; respect depth and active-child caps. Prefer doing small work yourself — **Frugal** has no subagent tools; **Shallow** allows depth 1 only.",
].join("\n");
