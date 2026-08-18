# ADR-0002: 内核边界

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** boundaries, licensing

## Context

session / loop / tools / host 是本仓产品内核，需要可审计、与本仓规格一致。聊天 UI、客户端插件图、Typert 信封等面非常吃人力；平行自研会丢掉对接，整棵 Cordis Host 嵌进来会丢掉本仓本质。

## Decision

内核能力在本仓实现与维护：**session 事件真源**、agent loop / 工具瀑布、compose / presets、进程插件 kind、Face 作为 wire 适配。

外部协议可对接。吃人力的非内核面（产品壳、DSH 客户端插件、`@deepseek-ai/*` 包名）在合法许可下**直接用**，不自研平行聊天 UI，也不改上游插件 id。品牌只换 title / 图标。

公开 npm 依赖须在 NOTICE 列出。

## Consequences

- 产品规格与实现以本仓 `docs/` + 代码为准
- Face 说 DSH wire，真源仍是 session 事件；未实现方法诚实 NI，禁止假成功
- 不把 Cordis `apply(ctx)` 当成 Host 内核
- 学习笔记见 [learn.md](../learn.md)
