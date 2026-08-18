# ADR-0002: 内核边界

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-08-19
- **Tags:** boundaries, licensing

## Context

session / loop / tools / host 是本仓产品内核，需要可审计、与本仓规格一致。聊天 UI、客户端插件图、Typert 信封等面非常吃人力；平行自研会丢掉对接，整棵 Cordis Host 嵌进来会丢掉本仓本质。

DSH Web 是 MIT。拷源码做本仓产品壳合法，但 **GitHub Fork / 跟踪上游 / 给 deepseek-ai 提 PR** 会把 XRK 绑成别人的贡献面，也容易把本仓改动冲回上游。

## Decision

内核能力在本仓实现与维护：**session 事件真源**、agent loop / 工具瀑布、compose / presets、进程插件 kind、Face 作为 wire 适配。不嵌 Cordis Host。

外壳：对 DSH Web 做 **MIT 二次创作**，不是 GitHub Fork。

- 定点拷贝进本仓（带 DeepSeek 版权声明与 MIT 全文），之后只在 **本仓** 改
- 无 DSH upstream remote、不跟踪 DSH 默认分支、**不对 deepseek-ai 仓库提 PR**
- 二次创作（品牌、裁剪、交互）发生在这份底稿上；`@deepseek-ai/*` 客户端包名可暂留（壳插件 id / wire），直到本仓改名
- 编译产物（`dist` / 捕获静态）不入库

当前落地：产品壳仍是本机捕获的静态面（gitignore）；Face 验证台在 `apps/web`。源码底稿尚未作为独立目录入库。

公开 npm 依赖须在 NOTICE 列出。

## Consequences

- 产品规格与实现以本仓 `docs/` + 代码为准
- Face 说 DSH 形 wire，真源仍是 session 事件；未实现方法诚实 NI，禁止假成功
- 不把 Cordis `apply(ctx)` 当成 Host 内核；产品 boot 省略 Cordis 客户端面板与捕获壳 HMR（插件文件可仍在磁盘）
- 对照 DSH 只为 CV 进本仓；改完不回提上游
- 学习笔记见 [learn.md](../learn.md)
