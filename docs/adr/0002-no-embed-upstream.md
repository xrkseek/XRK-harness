# ADR-0002: 不 vendor 第三方 agent 运行时

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** boundaries, licensing

## Context

本仓要保持可审计的自研内核边界：session / loop / tools / host 必须是本仓规格与实现，不能把外部 agent 运行时整树拷进 `packages/` 冒充自研。

## Decision

**禁止**将第三方 agent / harness **运行时源码树**并入本仓作为第二内核或 `kernel` / `core*` 依赖。

允许：

- 合法许可证下的 **归因移植**（须 NOTICE / 文件头）用于 UI 壳等非内核面
- 公开 npm 依赖，并在 NOTICE 列出
- 自研适配层对接外部协议形状（规格写在本仓 `docs/`）

## Consequences

- 产品叙事与实现均以本仓为准
- 学习对照留在维护者本地 / IDE Canvas，不进公开「参考清单」文档
