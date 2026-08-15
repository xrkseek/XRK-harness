# ADR-0004: 不引入 Effect 作为运行时内核

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** runtime, opencode, dependencies
- **TODO:** `lc10`
- **Depends on:** [0003](./0003-session-long-loop-short.md)、[learn/opencode-session-runner.md](../learn/opencode-session-runner.md)

## Context

OpenCode V2 core 大量使用 Effect（`Layer` / `Fiber` / `Schema` / `Service`）。其 **SessionRunCoordinator、admit/resume、settle** 等语义值得学，但实现绑定在 Effect 生态上。

若本仓以 Effect 为 harness 内核：

- 与「宿主仅 TypeScript（Node）+ 薄依赖」冲突（学习与贡献门槛陡增）
- 易把「门闩 / 队列」做成第三种真源错觉（ADR-0003 已拒）
- 与已落地的 Promise/`async` pipeline、`runTurn`、Vitest 风格不一致

## Decision

**不引入 Effect（及同类代数效应运行时）作为 XRK-Harness 的执行内核或公共 API 依赖。**

允许：

- 在 `docs/learn` 对照 Effect 版源码与规格，翻译为 Promise / 显式状态机
- 可选：文档中出现 Effect 类型名作对照，不进 `packages/*` 运行时依赖

禁止：

- `packages/**` 依赖 `effect` 或把 Layer/Fiber 当公共扩展点
- 以「与 OpenCode 对齐」为由引入 Effect 重写 session/loop/tools

## Consequences

- 门闩、wake coalesce、tool 并行用 **Promise + 显式结构**（见 lc4/lc5 立项）实现
- Schema 校验用 JSON Schema / 可选适配器，不用 Effect Schema
- 复盘 OpenCode 时只吸规格语义，不吸框架

## References

- OpenCode `specs/v2/session.md`、`run-coordinator.ts`、`tool/AGENTS.md`
- 本仓 learn lc4–lc6、lc8
