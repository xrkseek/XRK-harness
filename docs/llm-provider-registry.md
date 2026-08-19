# LLM Provider Registry

产品规格。`@xrkseek/llm-registry`：单路径解析与创建适配器。BrandEntries：[llm-provider-presets.md](./llm-provider-presets.md)。

## 目标

```text
resolve(input) → ProviderBinding → createAdapter(binding, secrets) → LlmAdapter
listForUi() / catalog() → Face `llm.providers` · `session.models`
```

- Host / CLI / `provider.use` / Face **只**走 Registry  
- 协议包 ≠ compat 工厂 ≠ 品牌条目  
- 密钥仅运行时注入；不入库  

## 状态

**R0**：openai-chat brands + env + Face 投影 + `discoverModels` GET `/models`。  
**R1 已交付**：官方协议包 + Registry 分发：

| ProtocolId | 包 / 工厂 | Brand |
|------------|-----------|-------|
| `openai-chat` / `openai-completions` | `@xrkseek/llm-openai-compatible` | R0 brands |
| `anthropic-messages` | `@xrkseek/llm-anthropic` | `anthropic` |
| `openai-responses` | `@xrkseek/llm-openai-responses` | `openai-responses` |
| `gemini-generate` | `@xrkseek/llm-gemini` | `gemini` |

Face `llm-pi-ai.providers.*.api` 写入后经 `readProviderRoute` → `resolve({ protocol })` 选工厂；覆盖协议时用目标协议默认 path。

见 [status.md](./status.md) · [llm-provider-presets.md](./llm-provider-presets.md)。

## 相关

[llm-provider-presets.md](./llm-provider-presets.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md) · [host-face.md](./host-face.md)
