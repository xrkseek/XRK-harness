# Architecture

宿主 **仅 TypeScript（Node ≥20）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

## 决策钉

| ADR | 决策 |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 无 Go / 多语言宿主树 |
| [0002](./adr/0002-no-embed-upstream.md) | 不并入上游源码 |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 |
| [0004](./adr/0004-no-effect-runtime.md) | 无 Effect 运行时 |

## 平面

```text
┌─────────────────────────────────────────────────────────┐
│  apps/cli · (future web)                                 │
├─────────────────────────────────────────────────────────┤
│  presets: minimal | harness | server   ← 只组合，无业务  │
│  @xrkseek/harness (sdk)                ← 稳定公共面      │
├─────────────────────────────────────────────────────────┤
│  server-host / http / config / loader                    │
├──────────────┬──────────────────┬───────────────────────┤
│ core-agent   │ core-agent-loop  │ core-tools            │
│ core-session │ system-prompt    │ workspace · policy*   │
├──────────────┴──────────────────┴───────────────────────┤
│  llm (+ replay) · exec-fs/shell/subprocess/sandbox       │
│  code-runtime · mcp* · compose*                          │
├─────────────────────────────────────────────────────────┤
│  kernel · protocol                                       │
└─────────────────────────────────────────────────────────┘
* = 空壳或薄壳 / 叶包分期，见 status.md
```

## 真源与投影

| 概念 | 实现 |
|------|------|
| 对话真源 | `SessionStore` 事件日志 |
| 模型可见历史 | `deriveMessages(events)`（+ compaction 窗口） |
| 不变量 | `assertModelVisible` — 模型输入必须可从事件重建 |
| Admit inbox | `prompt/admitted` → promote → `user/message` |
| Host 忙闲 | TurnLatch（直调）· SessionDrainHub（wake/resume） |

## Hot path（单 turn）

```text
continueTurn / drain
  → (optional) promoteAdmitsForTurn   // steers 合并；否则一条 queue
  → runTurn
       settleDanglingTools
       loop:
         assembleThreeLayers (+ workspaceBlocks)
         llm.chat
         tool/call → pipeline → tool/result (settle batch)
       optional compaction on overflow
  → session safety afterTurn
```

## 包职责（摘要）

| 包 | 职责 | 非目标 |
|----|------|--------|
| `kernel` | Context · Plugin · EventBus · applyPatches | Fiber / Ordering / Cordis |
| `compose` | Scope · effect · provide/inject · Ordering · isolate | Proxy · HMR · session 真源 |
| `protocol` | ChatMessage · SessionEvent · ToolCall | 运行时逻辑 |
| `core-session` | Store · derive · admit · latch · safety · compaction helpers | HTTP |
| `core-tools` | Registry · Pipeline · guards · materialize · bound | fs 实现 |
| `core-agent-loop` | `runTurn` · settle · runCompaction | Preset |
| `core-agent` | `createAgent` 薄柄 | Exec provider |
| `exec-*` | Fs/Shell/Sandbox seams | Session |
| `workspace` | inject · seeds · recipes · tool-output persist | Agent loop |
| `server-*` | HTTP · host drain · config | 具体 LLM vendor |
| `presets/*` | 组合 tools/pipeline/inject | 业务规则 |

## 扩展点（推荐顺序）

1. **新工具**：`ToolDefinition` → registry；需要 IO 则经 exec Provider。  
2. **新守卫**：`pipeline.onGuard`（单调 deny）。  
3. **新 preset**：复制 minimal/harness 组合模式，禁止塞业务。  
4. **新 LLM**：实现 `LlmAdapter`；先用 replay 锁测；OpenAI 形态网关用 `@xrkseek/llm-openai-compatible`；DeepSeek 默认用 `@xrkseek/llm-deepseek`。  
5. **MCP**：先 [learn/mcp-protocol.md](./learn/mcp-protocol.md) + 产品规格，再改 [status.md](./status.md)；空壳勿假 API。policy `mcp.connect` 默认 deny。  
6. **插件**：`kind: tools` 经 host → preset `wireCompositionTools`；其它 kind 无贡献协议。

## 相关

- [status.md](./status.md) — 能力矩阵  
- [seams.md](./seams.md) — exec 三元组  
- [host-preset.md](./host-preset.md) — Host vs Session 平面  
- [learn/three-way-map.md](./learn/three-way-map.md) — 对照吸收清单  
