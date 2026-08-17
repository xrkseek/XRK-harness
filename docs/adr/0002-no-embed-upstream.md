# ADR-0002: 内核边界

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** boundaries, licensing

## Context

session / loop / tools / host 是本仓产品内核，需要可审计、与本仓规格一致。

## Decision

内核能力在本仓实现与维护。外部协议可对接；UI 等非内核面可在合法许可下归因使用。公开 npm 依赖须在 NOTICE 列出。

## Consequences

- 产品规格与实现以本仓 `docs/` + 代码为准
- 学习笔记见 [learn.md](../learn.md)
