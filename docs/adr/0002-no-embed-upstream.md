# ADR-0002: 内核边界

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** boundaries, licensing

## Context

session / loop / tools / host 是本仓产品内核，需要可审计、与本仓规格一致。聊天 UI、客户端插件图、Typert 信封等面非常吃人力；平行自研会丢掉对接，整棵 Cordis Host 嵌进来会丢掉本仓本质。

## Decision

内核能力在本仓实现与维护：**session 事件真源**、agent loop / 工具瀑布、compose / presets、进程插件 kind、Face 作为 wire 适配。

外部协议可对接。吃人力的聊天壳在合法许可下**复用 DSH Web 捕获**（`@deepseek-ai/*` 包名不改），不另画平行聊天 UI。捕获产物不入库（同 DSH `apps/web/dist`）。产品向裁剪与品牌（boot 省略空面、title / manifest）在本仓做；内核仍是 session 事件 · 工具瀑布 · compose。

公开 npm 依赖须在 NOTICE 列出。

## Consequences

- 产品规格与实现以本仓 `docs/` + 代码为准
- Face 说 DSH wire，真源仍是 session 事件；未实现方法诚实 NI，禁止假成功
- 不把 Cordis `apply(ctx)` 当成 Host 内核；产品 boot 省略 Cordis 客户端面板与捕获壳 HMR（插件文件可仍在磁盘）
- 学习笔记见 [learn.md](../learn.md)
