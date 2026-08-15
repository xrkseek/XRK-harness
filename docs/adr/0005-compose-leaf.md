# ADR-0005: 时空可组合叶包 `@xrkseek/compose`

- **Status:** Accepted
- **Date:** 2026-08-15
- **Tags:** runtime, cordis-essence, kernel-boundary
- **Depends on:** [0002](./0002-no-embed-upstream.md)、[0004](./0004-no-effect-runtime.md)
- **Spec:** [superpowers/specs/2026-08-15-compose-design.md](../superpowers/specs/2026-08-15-compose-design.md)

## Context

Cordis / 论文给出插件系统的时空可组合标尺（可逆 effects、反应式 coeffects、Ordering、isolate）。本仓已完整学习（lc25），且：

- ADR-0002 禁止把 Cordis 并成 `kernel` / `core*` 第二运行时  
- ADR-0004 禁止以 Effect-TS 为执行内核  
- 现有 `kernel` 仅有薄 `Context.onDispose` + EventBus，**没有** Fiber 状态机、PENDING、依赖卸序、realm  

若把 Fiber/Ordering 直接塞进 `kernel`，会违背「kernel 保持更薄」与用户选定的叶包边界。

## Decision

新增能力叶 **`@xrkseek/compose`**：

- 用显式 TS 对象实现 Scope / effect / provide / inject / Ordering / isolate-label  
- **无** Proxy、无 Cordis 依赖、无 Effect-TS  
- `kernel` **不**依赖 `compose`；Host / Face / plugin **另接**  
- 分期：C0 叶包+测试 → C1 接线失效路径 → C2 intercept/subagent

## Alternatives Considered

### 强化 `@xrkseek/kernel`

- Pros: 少一个包  
- Cons: kernel 变厚；与「薄 DI + bus」定位冲突  
- Rejected: 用户选定叶包方案

### 直接改 Host 生命周期、kernel 只打补丁

- Pros: 产品侧见效快  
- Cons: 不变量无法单测隔离；底层与产品耦合  
- Rejected: 「让底层高级」要求先有可证明的叶

### 引入 `@deepseek-ai/cordis` 进 core

- Rejected: ADR-0002

## Consequences

- AGENTS 依赖纪律增加：`core*` / server → 可选 `compose`；`compose` → `kernel`；禁止 `kernel` → `compose`  
- 学习笔记 lc25 的「isolate 等价物」以本 ADR + 设计规格为产品真源入口  
- 短期多一层文档与版本面；换来 Host 接线前可独立验证的组合正确性
