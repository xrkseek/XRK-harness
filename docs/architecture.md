# Architecture

宿主 **仅 TypeScript（Node ≥20）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

## 决策

| ADR | 决策 |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 仅 TypeScript 宿主 |
| [0002](./adr/0002-no-embed-upstream.md) | 不 vendor 第三方 agent 运行时树 |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 |
| [0004](./adr/0004-no-effect-runtime.md) | 无代数效应运行时内核 |
| [0005](./adr/0005-compose-leaf.md) | 组合叶包 `@xrkseek/compose` |

## 平面

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
* = 空壳，见 status.md
```

## 真源与投影

| 概念 | 实现 |
|------|------|
| 对话真源 | `SessionStore` 事件日志 |
| 模型可见历史 | `deriveMessages(events)`（+ compaction） |
| 不变量 | `assertModelVisible` |
| Admit inbox | `prompt/admitted` → promote → `user/message` |
| Host 忙闲 | TurnLatch · SessionDrainHub |

## Hot path（单 turn）

```text
continueTurn / drain
  → promoteAdmitsForTurn（可选）
  → runTurn
       settleDanglingTools
       loop: assemble → llm.chat → tool pipeline → settle
       optional compaction
  → session safety afterTurn
```

## 包职责

| 包 | 职责 | 非目标 |
|----|------|--------|
| `kernel` | Context · Plugin · EventBus · patch | Scope / Ordering |
| `compose` | Scope · effect · provide/inject · Ordering | session 真源 · Proxy |
| `protocol` | ChatMessage · SessionEvent · ToolCall | 运行时逻辑 |
| `core-session` | Store · derive · admit · latch · safety | HTTP |
| `core-tools` | Registry · Pipeline · guards | fs 实现 |
| `core-agent-loop` | `runTurn` · settle · compaction | Preset 业务 |
| `core-agent` | `createAgent` | Exec 实现 |
| `exec-*` | Fs / Shell / Sandbox | Session |
| `workspace` | inject · recipes · persist | Agent loop |
| `server-*` | HTTP · Face · host drain | 具体 LLM SDK |
| `presets/*` | 组合 | 业务规则 |

## 扩展顺序

1. 新工具 → registry；IO 经 exec Provider  
2. 新守卫 → `pipeline.onGuard`  
3. 新 preset → 复制组合模式  
4. 新 LLM → `LlmAdapter` + Registry  
5. MCP → 先产品规格，空壳勿假 API  
6. 插件 → `kind: tools` 经 loader 接线  

## 相关

- [status.md](./status.md) · [seams.md](./seams.md) · [host-preset.md](./host-preset.md) · [compose.md](./compose.md)
