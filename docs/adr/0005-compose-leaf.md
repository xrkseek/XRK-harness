# ADR-0005: 组合叶包 `@xrkseek/compose`

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** runtime, composition, kernel-boundary
- **Depends on:** [0002](./0002-no-embed-upstream.md)、[0004](./0004-no-effect-runtime.md)
- **Spec:** [compose.md](../compose.md)

## Context

插件与 Host 生命周期需要：**可逆副作用**、**依赖卸序**、可选隔离域。这些不应塞进薄 `kernel`，也不应引入 Proxy 上帝对象或第三方组合运行时。

## Decision

新增能力叶 **`@xrkseek/compose`**：

- 显式 TS：Scope / effect / provide / inject / Ordering / isolate-label
- `kernel` 不依赖 `compose`；Host / Face 另接
- 分期：C0 叶包 → C1 Host agent-cache → C2 intercept/subagent

## Consequences

- AGENTS 依赖纪律含 compose
- 组合正确性可用单测独立验证，再接线产品路径
