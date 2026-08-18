# ADR-0002: 内核边界

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-08-19
- **Tags:** boundaries, licensing

## Context

session / loop / tools / host 是本仓产品内核。聊天 UI 吃人力；平行自研会丢掉对接，整棵 Cordis Host 嵌进来会丢掉本仓本质。

DSH Web 是 MIT。定点拷源码做二次创作合法，但 **GitHub Fork / 跟踪上游 / 给 deepseek-ai 提 PR** 会把 XRK 绑成别人的贡献面。

## Decision

内核在本仓实现：**session 事件真源**、agent loop / 工具瀑布、compose / presets、进程插件 kind、Face wire。不嵌 Cordis Host。

外壳：对 DSH Web 做 **MIT 二次创作**，不是 GitHub Fork。

- 标准路径与 DSH 对齐：`apps/web` + `packages/client/*`（源码；无 dist/lib）
- Face 验证台：`apps/console`
- 捕获产物：`apps/web-static`（gitignore）
- 无 vendor 联接；对照实现看本机 bar 仓（路径不进 docs）
- 无 DSH upstream remote、**不对 deepseek-ai 提 PR**
- 本仓根 [LICENSE](../../LICENSE)；DeepSeek 署名见 [apps/web/NOTICE](../../apps/web/NOTICE)

## Consequences

- 规格以本仓 `docs/` + 代码为准
- Face 说 DSH 形 wire，真源仍是 session 事件
- 产品 boot 省略 Cordis 客户端面板与捕获壳 HMR
- `apps/web` / `packages/client` 暂不进 pnpm workspace（编出仍依赖完整 DSH 树 + `XRK_UI_SRC`）
