# 集成者：XRK-AGT 嵌入 `@xrkseek/harness`

> **读者**：集成者 · AGT 维护者  
> **配对**：AGT 仓 `docs/harness-module-loop.md` · AGT ADR-0002  
> **能力边界**：[status.md](../status.md) · [publishing.md](../publishing.md)

AGT 保留通道业务（Tasker / Core / `chat.js` / MCPServer）。Agent loop（session · turn · tool pipeline · 厂商 adapter · compaction · safety）由 npm 包 **`@xrkseek/harness`** 在进程内承担。产品 CLI **`xrkh`**（`@xrkseek/harness-cli`）是独立 Host 产品，**不是** AGT 的库依赖。

## 安装

只依赖 SDK 门面，不要把 `@xrkseek/core-*` / `llm-*` 叶包写进集成方 `package.json`。

```bash
pnpm add @xrkseek/harness@0.1.28
```

离线或锁定 Release 资产时：

```bash
pnpm add https://github.com/xrkseek/XRK-harness/releases/download/v0.1.28/xrkseek-harness-0.1.28.tgz
```

开发期若需尚未发布的构建产物，用环境变量指向 **已构建的 SDK 入口文件**（绝对路径），勿把本机目录布局写进教科书或提交进仓：

```bash
# 值为 dist 入口的绝对路径，例如 …/packages/sdk/dist/index.js
set XRK_HARNESS_SDK=<absolute-path-to-sdk-entry>
```

## 数据流

```text
chat.js / MCP
  → AiWorkflow.callAI → runHarnessModuleLoop
       → 原生 adapter（DeepSeek / Anthropic / Responses / Gemini / OpenAI-compatible）
       → createAgent（compaction · llmRetry · safety · tool spill · toolSettle）
       → continueTurn

/v1 + workflow.workflows → 同上（MCP）
/v1 无 workflows、无 body.tools → 同上（Web 控制台）
/v1 无 workflows、有 body.tools → LLM 工厂单次补全（tool_calls 透传客户端）
```

## SDK 能力（AGT 已接）

| 符号 | 作用 |
|------|------|
| `createPersistentSessionStore` | AGT 进程内跨 turn 持久 session（`data/harness-sessions`） |
| `createMemorySessionStore` | 测例 / 回退；历史 seed（含 `tool/call` · `tool/result`） |
| `createToolRegistry` + `register` | MCP → harness 工具（只读启发式并行；`reply` → `concludesTurn`）；同 session + 同 workflows 复用 registry/pipeline |
| `createToolPipeline` + 自动批准 | IM / bot |
| `createAgent` · `continueTurn` | Loop · session safety · `toolSettle`；`sessionKey` 复用；无工具时 `maxSteps=1` |
| `settleDanglingTools` · `assertToolCallsSettled` · `listDanglingToolCalls` | Turn 后收口悬挂 tool |
| `compaction` | 来自 Provider `contextWindow` |
| `llmRetry` | 来自 `llm.retry`（`enabled:false` 关闭；`maxAttempts`/`delay`/`retryOn` 映射） |
| `safety` / `SessionSafetyLimitError` | 可配；上限 → `safetyLimited` |
| `createPolicyToolCallGuard` | `denyTools` |
| `beforeUserMessage` / `registerTools` 等 | 可选扩展钩子 |
| `createMemoryAttachmentStore` + `resolveImage` | OpenAI data-URL 图 → ContentBlock |
| 厂商 adapter · `peekRoute` / `reasoningEffort` | Provider 配置映射 |
| `createReplayAdapter` | 测例 |
| 结果 | `content` · `steps` · `sessionId` · `reused`；`maxToolRounds` → `maxSteps` |
| `/v1` OpenAI `stream` | 步内 `assistant/chunk` → SSE；`mcp_tools` 含 arguments/result；非 OpenAI 网关仍整段 JSON |

AGT 侧 MCP **执行**仍走 `MCPServer`（经 `MCPToolAdapter`），不改用 SDK `createMcpClient`。

## 可选：单独跑 Host

```bash
xrkh serve --preset server --workspace <path>
```

嵌入模式不需要。

---

# Integrator: XRK-AGT embeds `@xrkseek/harness`

> **Audience**: Integrators · AGT maintainers  
> **Pair**: AGT `docs/harness-module-loop.md` · AGT ADR-0002  
> **Capability**: [status.md](../status.md) · [publishing.md](../publishing.md)

AGT keeps channel business (Tasker / Core / `chat.js` / MCPServer). The agent loop (session · turn · tool pipeline · vendor adapters · compaction · safety) runs **in-process** via **`@xrkseek/harness`**. The product CLI **`xrkh`** (`@xrkseek/harness-cli`) is a separate Host product — **not** an AGT library import.

## Install

Depend on the SDK façade only. Do not add leaf `@xrkseek/core-*` / `llm-*` packages to the integrator `package.json`.

```bash
pnpm add @xrkseek/harness@0.1.28
```

Offline / pin a Release asset:

```bash
pnpm add https://github.com/xrkseek/XRK-harness/releases/download/v0.1.28/xrkseek-harness-0.1.28.tgz
```

For unpublished local builds, point an env var at the **built SDK entry file** (absolute path). Do not commit machine layout into docs or the repo:

```bash
# Absolute path to the SDK entry, e.g. …/packages/sdk/dist/index.js
export XRK_HARNESS_SDK=<absolute-path-to-sdk-entry>
```

## Data flow

```text
chat.js / MCP
  → AiWorkflow.callAI → runHarnessModuleLoop
       → native adapter (DeepSeek / Anthropic / Responses / Gemini / OpenAI-compatible)
       → createAgent(compaction · llmRetry · safety · tool spill · toolSettle)
       → continueTurn

/v1 + workflow.workflows → same (MCP)
/v1 without workflows and without body.tools → same (web console)
/v1 without workflows + body.tools → LLM factory single-shot (tool_calls passthrough)
```

## SDK wheels AGT uses

| Symbol | Role |
|--------|------|
| `createPersistentSessionStore` | Cross-turn durable sessions in AGT (`data/harness-sessions`) |
| `createMemorySessionStore` | Tests / fallback; history seed (`tool/call` · `tool/result`) |
| `createToolRegistry` + `register` | MCP → harness tools (read-only parallel heuristic; `reply` → `concludesTurn`); reuse registry/pipeline for same session + workflows |
| `createToolPipeline` + auto-approve | IM / bot |
| `createAgent` · `continueTurn` | Loop · session safety · `toolSettle`; `sessionKey` reuse; `maxSteps=1` when no tools |
| `settleDanglingTools` · `assertToolCallsSettled` · `listDanglingToolCalls` | Close dangling tools after turn |
| `compaction` | From Provider `contextWindow` |
| `llmRetry` | From `llm.retry` (`enabled:false` off; map `maxAttempts` / `delay` / `retryOn`) |
| `safety` / `SessionSafetyLimitError` | Tunable; limit → `safetyLimited` |
| `createPolicyToolCallGuard` | From `denyTools` |
| `beforeUserMessage` / `registerTools` | Optional hooks |
| `createMemoryAttachmentStore` + `resolveImage` | OpenAI data-URL vision → ContentBlock |
| Vendor adapters · `peekRoute` / `reasoningEffort` | From Provider config |
| `createReplayAdapter` | Tests |
| Result | `content` · `steps` · `sessionId` · `reused`; `maxToolRounds` → `maxSteps` |
| `/v1` OpenAI `stream` | Live `assistant/chunk` → SSE; `mcp_tools` with arguments/result; non-OpenAI gateways still full JSON |

AGT MCP **execution** stays on `MCPServer` via `MCPToolAdapter` (not SDK `createMcpClient`).

## Optional Host-only

```bash
xrkh serve --preset server --workspace <path>
```

Not required for AGT embed mode.
