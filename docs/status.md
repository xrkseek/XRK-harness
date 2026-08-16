# Status（能力矩阵）

> 与仓库实现对齐。改代码后优先改本页与根 [README](../README.md)。基线：2026-08。

## Shipped

| 域 | 包 / 入口 | 规格 |
|----|-----------|------|
| Kernel DI / bus / patch | `@xrkseek/kernel` | 包 README；覆盖率 ≥90% 进 check |
| Compose Scope / Ordering | `@xrkseek/compose` · host agent-cache | [compose.md](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session 事件 · admit · derive | `@xrkseek/protocol` · `@xrkseek/core-session` | [session.md](./session.md) · [protocol-events.md](./protocol-events.md) |
| Delivery queue/steer | session + HTTP | [session-delivery.md](./session-delivery.md) |
| Agent · TurnLatch · safety | `@xrkseek/core-agent` | [session-api.md](./session-api.md) · [session-safety.md](./session-safety.md) |
| Agent loop · settle · compaction | `@xrkseek/core-agent-loop` | [tool-settlement.md](./tool-settlement.md) · [session-compaction.md](./session-compaction.md) |
| Tool pipeline | `@xrkseek/core-tools` | [tool-pipeline.md](./tool-pipeline.md) |
| Three-layer prompt | `@xrkseek/core-system-prompt` | 包 README |
| Exec fs/shell/sandbox | `@xrkseek/exec-*` | [seams.md](./seams.md) · [shell-jobs.md](./shell-jobs.md) |
| Workspace · slash recipes | `@xrkseek/workspace` · presets | [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) |
| Policy · ask/approval | `@xrkseek/policy` · host · face | [policy.md](./policy.md) |
| Presets | minimal · harness · server | [profiles.md](./profiles.md) |
| HTTP + host | server-http · host · config | [http-api.md](./http-api.md) |
| Plugin loader（tools） | `@xrkseek/server-loader` | [plugin-loader.md](./plugin-loader.md) |
| Public SDK | `@xrkseek/harness` | [packages/sdk/README](../packages/sdk/README.md) |
| LLM replay / OpenAI 兼容 / DeepSeek 预设 | llm-* | [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md) |
| Provider Registry R0 | `@xrkseek/llm-registry` | [llm-provider-registry.md](./llm-provider-registry.md) |
| Host Face · AppShell | `@xrkseek/server-face` · `apps/web` · web-runtime | [host-face.md](./host-face.md) |
| Code runtime（实验） | `@xrkseek/code-runtime` | [code-mode.md](./code-mode.md) |

## Partial

| 域 | 现状 |
|----|------|
| Non-`tools` plugin kinds | 可登记；无贡献协议 |
| Provider Registry | R0 已交付；R1+ 协议包待做 |
| Host Face | 主 RPC / WS / workspace / settings / fork / approval 已接；attachment · search 等仍未实现 |
| Compose | C0 叶包 + C1 Host agent-cache；C2 intercept / subagent 未做 |

## Empty（禁止当产品依赖）

| 包 | 说明 |
|----|------|
| `@xrkseek/mcp` | `export {}` — 先写产品规格再实现 |

## 依赖纪律（摘要）

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

禁止：server → 具体 llm 适配；core-agent → exec 实现；`kernel` → `compose`。  
完整：[AGENTS.md](../AGENTS.md) · [architecture.md](./architecture.md)。
