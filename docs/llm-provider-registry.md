# LLM Provider Registry / LLM Provider Registry

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

产品规格。`@xrkseek/llm-registry`：单路径解析与创建适配器。BrandEntries：[llm-provider-presets.md](./llm-provider-presets.md)。

Product spec. `@xrkseek/llm-registry` is the single path to resolve and create adapters. BrandEntries: [llm-provider-presets.md](./llm-provider-presets.md).

## 目标 / Goals

```text
resolve(input) → ProviderBinding → createAdapter(binding, secrets) → LlmAdapter
listForUi() / catalog() → Face `llm.providers` · `session.models`
```

- Host / CLI / `provider.use` / Face **只**走 Registry  
- 协议包 ≠ compat 工厂 ≠ 品牌条目  
- 密钥仅运行时注入；不入库  

## 状态 / Status

**R0**：openai-chat brands + env + Face 投影 + `discoverModels` GET `/models`。  
**R1 已交付**：官方协议包 + Registry 分发：

| ProtocolId | 包 / 工厂 | Brand |
|------------|-----------|-------|
| `openai-chat` / `openai-completions` | `@xrkseek/llm-openai-compatible` | R0 brands |
| `anthropic-messages` | `@xrkseek/llm-anthropic` | `anthropic` |
| `openai-responses` | `@xrkseek/llm-openai-responses` | `openai-responses` |
| `gemini-generate` | `@xrkseek/llm-gemini` | `gemini` |

Face `llm-pi-ai.providers.*.api` 写入后经 `readProviderRoute` → `resolveProviderBinding` 选工厂；覆盖协议时用目标协议默认 path。

### Prompt cache（DeepSeek / Anthropic 等前缀缓存）

对齐 DSH：模型可见前缀尽量 **append-only**。

| 做法 | 作用 |
|------|------|
| tools **按 name 字典序** | 注册 / MCP 热挂顺序不进入 wire |
| 可选 `toolOrder: string[]`（恰好一个 `' '` rest） | 固定常用工具位置；错配 fail-loud；缺省 = 纯字典序。Face `agent-loop.toolOrder` → Host → `assemble.toolOrder`（settings.yaml）；`@xrkseek/core-system-prompt` |
| volatile **不进 system** | 时钟与 session id 只在 user 尾缀 |
| 同 turn 后续 step：关 `[current message]` 与 volatile `time:` | 工具循环不每步挪动对话中段 |
| Anthropic `cache_control: { type: "ephemeral" }` | system 文本块 + 最后一个 tool 定义打 breakpoint；`chat`/`stream` usage 映射 `cache_read_input_tokens` / `cache_creation_input_tokens` → `cacheReadTokens` / `cacheWriteTokens` |

StatsLine「缓存命中」= `cacheReadTokens / (uncached + cacheRead + cacheWrite)`（`tokenUsage` 投影）。换模型 / 改 system（plan · recipe）仍会整段 miss。

### 协议 / 字段别名（保留）

协议栈上的别名是契约的一部分，**不要**为「去冗余」删掉读侧兼容：

| 别名 | 含义 |
|------|------|
| `openai-completions` | 与 `openai-chat` 同工厂 |
| settings `baseURL` / `baseUrl` | 同一 endpoint；schema 写 `baseURL`，读侧两者都认 |
| Registry brand `custom` | 预设占位（须自带 baseUrl）；**不等于** Settings 手写路由 id |

## Settings 手写路由（Custom provider）

产品 Settings → Models → Custom provider 写入 `llm-pi-ai.providers.<id>`（如 `xyt`）。该 id **不是** Registry brand。

| 面 | 行为 |
|----|------|
| `llm.providers` / `llm.models` / `session.models` | 列出声明路由（`declared: true`） |
| `session.selectModel` · agent LLM | `resolveProviderBinding`：有 brand 走 Registry；否则从 profile **合成** `ProviderBinding` |
| 凭据 | `apiKeyEnv` → `credentials` 槽 `llm.<id>` |
| 禁止 | 产品选择路径直接 `registry.resolve(provider)`（会 `unknown provider`） |

实现落点：`packages/server/face/src/llm-provider-context.ts` · `llm-resolve.ts` · `model-catalog.ts`。

### 改这条链路时的完成清单

缺一项 = 半截改动（列表能亮、点选报错）：

1. **列出**：`listDeclaredPiAiProviders` → catalog / `llm.providers`
2. **解析**：`resolveProviderBinding`（含合成）→ `resolveLlmForSelection` / `session.selectModel` / discovery
3. **凭据**：`listSettingsProviderCredentialRefs` + vault `llm.<id>`
4. **测**：至少一条 Face 测「mutate 声明路由 → selectModel 成功」
5. **构建**：`tsc -b packages/server/face`（及依赖它的 host/cli）后重启本机 `web`/`serve`

见 [status.md](./status.md) · [llm-provider-presets.md](./llm-provider-presets.md) · [modules/server-face.md](./modules/server-face.md)。

## 相关

[llm-provider-presets.md](./llm-provider-presets.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md) · [host-face.md](./host-face.md)
