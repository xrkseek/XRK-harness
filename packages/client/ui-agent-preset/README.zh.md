# @xrkseek/client-ui-agent-preset

Agent 预设设置行、英雄芯片、会话头标签与管理页。

## 内置徽章

XRK Face **内置五种工具面**：`minimal` · `shell` · `frugal` · `shallow` · `harness`（UI：**XRK Harness**）。计划模式用 **`/plan`**，不是徽章。工作区 `.xrk` 种子是另一层（人格 / 规则），不是又一种工具表。见 [docs/profiles.md](../../../docs/profiles.md)。

## 设置接线

`agentPreset.list` 一次给出名单与默认；写入 `agent-presets.default`。

预设文件为 `user` 行与未知 `system` 行发布未本地化的 `name` / `description`。五个内置 id 在 roster 标为 `system` 时，由 Web 按当前语言解析文案。

设置页 `agent-presets`：花名册卡片、复制对话框、内置组装只读查看。浏览器不改 composition YAML — 新预设由 Host 侧复制。
