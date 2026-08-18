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

**R0 已交付**（openai-chat brands + env + Face 投影 + `discoverModels` GET `/models`）。R1+ 官方协议包待做。见 [status.md](./status.md)。

## 相关

[llm-provider-presets.md](./llm-provider-presets.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md) · [host-face.md](./host-face.md)
