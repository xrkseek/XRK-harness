# ADR-0004: 不引入代数效应运行时作为内核

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** runtime, dependencies
- **Depends on:** [0003](./0003-session-long-loop-short.md)

## Context

部分生态用代数效应（Layer / Fiber / Effect 风格）组织 session 与工具执行。若本仓以该类库为公共内核：

- 学习与贡献门槛陡增
- 易与 ADR-0003 的「session 真源」混淆出第三种状态真源
- 与现有 Promise / async pipeline、Vitest 风格不一致

## Decision

**不**将代数效应运行时（及同类）作为 XRK-Harness 执行内核或公共 API 依赖。

允许：用 Promise + 显式状态机表达同等语义（见 latch / settle / compose）。

禁止：`packages/**` 依赖 `effect` 等库，或以「对齐某框架」为由重写 session/loop。

## Consequences

- 门闩、wake、tool 并行用 Promise + 显式结构
- Schema 用 JSON Schema / 可选适配器
