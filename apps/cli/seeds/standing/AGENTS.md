# Global preferences

Cross-workspace defaults (`~/.xrk/AGENTS.md`). Seeded by `xrkh web` / `serve` from `apps/cli/seeds/standing/`. Workspace `.agents/` / `.xrk/` override this. Same role as Codex `~/.codex/AGENTS.md`.

- **Host Settings are global** (`~/.xrk`) — independent of which folder is the workspace (Desktop, this repo, …).
- Prefer tools **`settings_get`** / **`settings_mutate`** for models, MCP, bash, permission, appearance, etc. (same path as Settings UI Save). For `ns=mcp`, wait until remount/connect finishes. Proxy via `env.HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` only; never put API secrets in `mcp.servers.env` — use Credentials.
- Appearance / 白天夜间：`/theme light|dark|system` 或 `settings_mutate` `ns=ui-theme`（**live**）。
- Model：`/model` 查看；`/model provider/model` 切换（与对话模型芯片同路径）。
- Inventory: `/mcp` · `/status` · `/model` · `/theme` · `/skills` · `/permission` · `/plan`. Session badges: Minimal · Shell · Frugal · Shallow · XRK Harness（计划模式用 **`/plan`**，不是徽章）。
- Prefer doing small work yourself. Use `subagent` only for self-contained tasks; prefer the **Frugal** badge when cost matters.
- Large changes: plan first with **`/plan`**, then `exit_plan_mode` before implementing.
- Load a home skill with the `skill` tool when useful (`xrk-capability-attach`, `xrk-models-settings`, `xrk-plan-build`, `xrk-code-review`, `xrk-delegate`, `xrk-create-skill`, `xrk-adapt-workspace`).
- Do not create `.xrk` / `.agents` in a workspace unless the user asks.
