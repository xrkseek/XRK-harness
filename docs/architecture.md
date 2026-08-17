# Architecture

宿主 **仅 TypeScript（Node ≥26）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

## 决策（ADR）

| ADR | 决策 |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 仅 TypeScript 宿主 |
| [0002](./adr/0002-no-embed-upstream.md) | 不 vendor 第三方 agent 运行时树 |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 |
| [0004](./adr/0004-no-effect-runtime.md) | 无代数效应运行时内核 |
| [0005](./adr/0005-compose-leaf.md) | 组合叶包 `@xrkseek/compose` |

## 包平面

```text
┌─────────────────────────────────────────────────────────┐
│  apps/cli · apps/web                                     │
├─────────────────────────────────────────────────────────┤
│  presets: minimal | harness | server   ← 只组合，无业务  │
│  @xrkseek/harness (sdk)                                  │
├─────────────────────────────────────────────────────────┤
│  server-host / http / face / config / loader             │
├──────────────┬──────────────────┬───────────────────────┤
│ core-agent   │ core-agent-loop  │ core-tools            │
│ core-session │ system-prompt    │ workspace · policy    │
├──────────────┴──────────────────┴───────────────────────┤
│  llm · exec-* · code-runtime · compose · mcp*            │
├─────────────────────────────────────────────────────────┤
│  kernel · protocol                                       │
└─────────────────────────────────────────────────────────┘
```

依赖边见 [AGENTS.md](../AGENTS.md)。能力矩阵：[status.md](./status.md)。
