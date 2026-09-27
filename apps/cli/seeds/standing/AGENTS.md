# Global preferences

Cross-workspace defaults (`~/.xrk/AGENTS.md`). Seeded by `xrkh web` / `serve` from `apps/cli/seeds/standing/`. Workspace `.agents/` / `.xrk/` override this. Same role as Codex `~/.codex/AGENTS.md`.

- **Host Settings are global** (`~/.xrk`) — independent of which folder is the workspace (Desktop, this repo, …).
- Prefer tools **`settings_get`** / **`settings_mutate`** for models, MCP, bash, permission, appearance, etc. (same path as Settings UI Save). For `ns=mcp`, wait until remount/connect finishes. Proxy via `env.HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` only; never put API secrets in `mcp.servers.env` — use Credentials.
- Appearance / 白天夜间：`/theme light|dark|system` 或 `settings_mutate` `ns=ui-theme`（**live**）。
- Model：`/model` 查看；`/model provider/model` 切换（与对话模型芯片同路径）。
- Inventory: `/mcp` · `/status` · `/model` · `/theme` · `/skills` · `/permission` · `/plan`. Session badges: Minimal · Shell · Frugal · Shallow · XRK Harness（计划模式用 **`/plan`**，不是徽章）。
- Prefer doing small work yourself. Use `subagent` only for self-contained tasks; prefer the **Frugal** badge when cost matters.
- Large changes: plan first with **`/plan`**, then `exit_plan_mode` before implementing.
- **Runtime surface**：Workspace inject（工作区根锚点）里的 `## Runtime surface` 标明你跑在哪种壳 —— **desktop**（Electron 桌面端：原生文件/目录选择与 `host.openPath` 可用，没有浏览器标签；Host 走管道而非 loopback HTTP）/ **web**（浏览器标签，`xrkh web` / `serve`；OS 对话框不保证可用）/ **tui** / **acp** / **cli**。按所在形态说话与选工具，别把别的形态的能力套过来。Desktop Host 会声明 `XRK_SURFACE=desktop`；浏览器侧由 CLI 声明 `web`。
- Load a home skill with the `skill` tool when useful (`xrk-capability-attach`, `xrk-models-settings`, `xrk-plan-build`, `xrk-code-review`, `xrk-delegate`, `xrk-create-skill`, `xrk-adapt-workspace`).
- Do not create `.xrk` / `.agents` in a workspace unless the user asks.
- Persona tone (optional): user-authored `~/.xrk/SOUL.md` / `IDENTITY.md`. Factual “who the user is” → curated `{XRK_HOME}/memories/USER.md` via the `memory` tool — not standing `USER.md`.

- **境外网络访问**：本机 Clash Verge 代理 `http://127.0.0.1:7897`。访问国外站点（GitHub 等）超时 / EOF / 10060 时走代理：PowerShell `-Proxy http://127.0.0.1:7897`、`$env:HTTPS_PROXY='http://127.0.0.1:7897'`、git `-c http.proxy=http://127.0.0.1:7897`。注意 `api.github.com` 直连与代理哪条通会变，先各探一次别固定；`registry.npmjs.org` 一直直连可达。
