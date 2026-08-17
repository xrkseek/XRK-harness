# Architecture（XRK 落点）

宿主 **仅 TypeScript（Node ≥26）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

> **基础架构心智与术语：不要读本页当「精简 DSH」。**  
> 照搬原文在 [upstream/deepseek-harness/architecture.zh.md](./upstream/deepseek-harness/architecture.zh.md)（及 `.md` 英文本）。  
> 能力缝：[capability-seams.zh.md](./upstream/deepseek-harness/capability-seams.zh.md)  
> 工具管线：[tool-execution-pipeline.zh.md](./upstream/deepseek-harness/tool-execution-pipeline.zh.md)  
> Cordis：[cordis-primer.zh.md](./upstream/deepseek-harness/cordis-primer.zh.md)  
> 合并说明：[upstream/deepseek-harness/README.md](./upstream/deepseek-harness/README.md)

## 本仓决策（XRK ADR）

| ADR | 决策 |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 仅 TypeScript 宿主 |
| [0002](./adr/0002-no-embed-upstream.md) | 不 vendor 第三方 agent 运行时树（参考树用 junction，规格照搬进 `docs/upstream/`） |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 |
| [0004](./adr/0004-no-effect-runtime.md) | 无代数效应运行时内核 |
| [0005](./adr/0005-compose-leaf.md) | 组合叶包 `@xrkseek/compose` |

## 本仓平面（实现树）

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

依赖边与红线见根 [AGENTS.md](../AGENTS.md)。完成度见 [status.md](./status.md)。
