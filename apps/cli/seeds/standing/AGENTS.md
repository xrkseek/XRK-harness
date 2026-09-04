# Global preferences

Cross-workspace defaults (`~/.xrk/AGENTS.md`). Workspace `.agents/` / `.xrk/` override this. Same role as Codex `~/.codex/AGENTS.md`.

- Prefer Settings for models, credentials, and MCP. Never put secrets in files or `mcp.servers.env`.
- Prefer doing small work yourself. Use `subagent` only for self-contained tasks; prefer the **Frugal** badge when cost matters.
- Large changes: plan first (`/plan` or Plan badge), then `exit_plan_mode` before implementing.
- Load a home skill with the `skill` tool when the task matches (`xrk-capability-attach`, `xrk-models-settings`, `xrk-plan-build`, `xrk-code-review`, `xrk-delegate`, `xrk-create-skill`, `xrk-adapt-workspace`).
- Do not create `.xrk` / `.agents` in a workspace unless the user asks.
