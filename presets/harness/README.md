# presets/harness

**XRK Harness** session composition（Face 徽章 id `harness`）: fs + bash + std · web · lsp · pty · sandbox · workspace inject · optional `run_code`.

Host 入口名 `server`（`presets/server`）只包一层 `AgentFactory`，工具面与本包相同。

`workspaceInject` / `slashRecipes` default on with assemble — see `docs/workspace-inject.md`, `docs/slash-recipes.md`, `docs/profiles.md`.
插件扩展：`docs/plugin-development.md`。
