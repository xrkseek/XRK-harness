# ADR-0004: 不引入代数效应运行时作为内核

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** runtime, dependencies
- **Depends on:** [0003](./0003-session-long-loop-short.md)

## 背景

部分生态用代数效应（Layer / Fiber / Effect 风格）组织 session 与工具执行。若本仓以该类库为公共内核：

- 学习与贡献门槛陡增
- 易与 ADR-0003 的「session 真源」混淆出第三种状态真源
- 与现有 Promise / async pipeline、Vitest 风格不一致

## 决策

**不**将代数效应运行时（及同类）作为 XRK-Harness 执行内核或公共 API 依赖。

允许：用 Promise + 显式状态机表达同等语义（见 latch / settle / compose）。

禁止：`packages/**` 依赖 `effect` 等库，或以「换内核运行时」为由重写 session/loop。

## 后果

- 门闩、wake、tool 并行用 Promise + 显式结构
- Schema 用 JSON Schema / 可选适配器

---

# ADR-0004: No algebraic-effect runtime as kernel

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** runtime, dependencies
- **Depends on:** [0003](./0003-session-long-loop-short.md)

## Context

Some ecosystems organize session and tool execution with algebraic effects (Layer / Fiber / Effect style). Making such a library the shared kernel here would:

- Raise the learning and contribution bar sharply
- Risk a third state source of truth beside ADR-0003’s session log
- Clash with the existing Promise / async pipeline and Vitest style

## Decision

Do **not** use an algebraic-effect runtime (or peers) as the XRK-Harness execution kernel or public API dependency.

Allowed: express the same semantics with Promise + explicit state machines (see latch / settle / compose).

Forbidden: `packages/**` depending on `effect` and peers, or rewriting session/loop solely to swap the kernel runtime.

## Consequences

- Latches, wake, and tool parallelism use Promise + explicit structures
- Schemas use JSON Schema / optional adapters
