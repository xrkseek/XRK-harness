# Status（能力矩阵）

> 与仓库实现对齐的扩展边界。日期基线：2026-08。改代码后优先改本页。

## Shipped（可依赖）

| 域 | 包 / 入口 | 规格 |
|----|-----------|------|
| Kernel DI / bus / patch | `@xrkseek/kernel` | 包 README；覆盖率 ≥90% 进 check |
| Session 事件 · validate · derive · admit | `@xrkseek/protocol` · `@xrkseek/core-session` | [session.md](./session.md) · [protocol-events.md](./protocol-events.md) |
| Delivery queue/steer | session + HTTP | [session-delivery.md](./session-delivery.md) |
| Agent · TurnLatch · safety | `@xrkseek/core-agent` | [session-api.md](./session-api.md) · [session-safety.md](./session-safety.md) |
| Agent loop · settle · compaction | `@xrkseek/core-agent-loop` | [tool-settlement.md](./tool-settlement.md) · [session-compaction.md](./session-compaction.md) |
| Tool pipeline | `@xrkseek/core-tools` | [tool-pipeline.md](./tool-pipeline.md) |
| Three-layer prompt | `@xrkseek/core-system-prompt` | 包 README |
| Exec fs/shell/sandbox | `@xrkseek/exec-*` | [seams.md](./seams.md) · [shell-jobs.md](./shell-jobs.md) |
| Workspace inject / persist | `@xrkseek/workspace` | [workspace-inject.md](./workspace-inject.md) |
| Slash recipes (hot path) | workspace + agent-loop + presets | [slash-recipes.md](./slash-recipes.md) |
| Policy engine + ruleset + Host file | `@xrkseek/policy` · host · face | [policy.md](./policy.md) · `XRK_POLICY_FILE` · `provider.use` · ask UI（`approval/*` + respond） |
| Presets | `preset-minimal` · `harness` · `server` | [profiles.md](./profiles.md) |
| HTTP + host | `server-http` · `server-host` · `server-config` | [http-api.md](./http-api.md) |
| Plugin loader · tools wire | `@xrkseek/server-loader` · host · presets | [plugin-loader.md](./plugin-loader.md) · [learn lc13](./learn/plugin-tools-wire.md) |
| Public SDK | `@xrkseek/harness` | [packages/sdk/README](../packages/sdk/README.md) |
| Replay LLM | `@xrkseek/llm-replay` | 测例 / 无密钥 |
| OpenAI-compatible LLM | `@xrkseek/llm-openai-compatible` | [llm-openai-compatible.md](./llm-openai-compatible.md) |
| Provider Registry R0 | `@xrkseek/llm-registry` | [llm-provider-registry.md](./llm-provider-registry.md) · BrandEntries |
| Host Face U1+ / U2 | `@xrkseek/server-face` | [host-face.md](./host-face.md) · [lc23](./learn/face-workspace.md) · [lc24](./learn/face-settings-credentials.md) |
| Web client algorithms | `@xrkseek/web-runtime` | [learn lc20](./learn/web-client-algorithms.md) · optimism · SlotRegistry · FaceSessionView |
| XRK AppShell | `apps/web` | [learn lc22](./learn/xrk-app-shell.md) · chrome + workspace + settings |
| DeepSeek LLM（defaults 薄预设） | `@xrkseek/llm-deepseek` | [llm-deepseek.md](./llm-deepseek.md) · [learn lc11](./learn/openai-compatible-llm.md) |
| Code runtime（实验） | `@xrkseek/code-runtime` | [code-mode.md](./code-mode.md) |

## Partial / thin

| 域 | 现状 | 勿假设 |
|----|------|--------|
| Outbound default `slashRecipeStep` | noop unless `createDefaultOutbound({ resolveSlash })` | 热路径已挂 `assemble.resolveSlash` |
| Non-`tools` plugin kinds | 可登记；无贡献协议 | 勿假设 channel/MCP 等已接线 |
| Policy 主机闭环 | `XRK_POLICY_FILE` + Face selectModel + ask/respond 已接 | MCP Client / 热重载 **未接**；见 [learn/policy-gates.md](./learn/policy-gates.md) |
| 已交付学习债 | 产品 Shipped ≠ 学尽 | [learn/shipped-audit.md](./learn/shipped-audit.md) |
| Provider Registry | R0 shipped (`resolve`→`create` + BrandEntries + env); R1+ protocols pending | [llm-provider-registry.md](./llm-provider-registry.md) |
| Web UI / Host Face | Face U1+ · U2 workspace/settings/cred · **fork** · AppShell；attachment/search 等仍 NI；Cordis 非目标 | [host-face.md](./host-face.md) · [lc24](./learn/face-settings-credentials.md) |

## Empty shells（禁止当产品依赖）

| 包 | 代码 |
|----|------|
| `@xrkseek/mcp` | `export {}` |

扩展时：先在 IDE Canvas（`xrk-harness-status-capability` · `xrk-harness-face-host-web` · `xrk-harness-00-index` / atomic WBS）立项，再写规格，再写实现。

## 依赖纪律（摘要）

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | exec* | workspace | policy
core* / 能力叶 → kernel | protocol
```

禁止：server → 具体 llm 适配；core-agent → exec 实现；extensions → apps 内部。  
完整：[AGENTS.md](../AGENTS.md) · [architecture.md](./architecture.md)。
