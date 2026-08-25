/**
 * Model-facing subagent routing (injected every turn when tools are bound).
 * Kept in core-tools so presets can register without depending on server-face.
 */

export const SUBAGENT_ROUTING_PROMPT_TEXT = [
  "Subagents:",
  "- Use `subagent` to delegate a self-contained task (fresh child context).",
  "- Foreground (default): waits and returns the child's final answer.",
  "- Background (`run_in_background: true`): returns a durable child session id; you are notified in-session when it finishes a turn — follow up with `send_message` / `interrupt_agent`; list with `list_agents`.",
  "- Do not nest beyond the configured depth; prefer independent parallel children over deep chains.",
].join("\n");
