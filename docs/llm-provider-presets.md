# LLM Provider Brand Entries（Registry · BrandEntries）

> **从属** [learn/provider-registry.md](./learn/provider-registry.md)（lc18）。  
> **不是**产品终点：禁止「只有常量表、无 `resolve`→`create` 单路径」。  
> 全景：[learn/provider-matrix.md](./learn/provider-matrix.md)。

## 目标

- 短 id → 合理的 `baseUrl` / `authMode` / `path` / `apiKeyEnv`（BrandEntries）。  
- **品牌 ≠ 新 npm 包**；官方协议分叉走独立协议包（R1/R2）。  
- 对外 API 走 **ProviderRegistry**，本表只是条目数据。

## API 意向（R0 · 经 Registry）

```ts
import { createProviderRegistry, OPENAI_CHAT_BRANDS } from "@xrkseek/llm-registry"; // 名待定

const reg = createProviderRegistry({ brands: OPENAI_CHAT_BRANDS, factories: [...] });
const binding = reg.resolve({ provider: "openrouter", model: "anthropic/claude-sonnet-4" });
const llm = reg.createAdapter(binding, { apiKey: process.env.OPENROUTER_API_KEY });
```

`OpenAiCompatiblePreset` 字段（草案）：

| 字段 | 含义 |
|------|------|
| `id` | 稳定短名 |
| `displayName` | UI/文档 |
| `protocol` | 固定 `openai-chat`（本表） |
| `baseUrl` | 默认 endpoint（无尾斜杠要求与现适配器一致） |
| `authMode` | 默认 `bearer`（Azure 类可 `api-key`） |
| `path` | 默认 `/chat/completions`（NewAPI/Cherry 类可覆盖） |
| `defaultModel` | 文档提示；**不强制** |
| `apiKeyEnv` | 推荐环境变量名（不读密钥入库） |
| `notes` | 网关怪癖一行 |

## 预设表（Chat Completions · P0）

| id | displayName | baseUrl（默认） | apiKeyEnv | 来源对照 |
|----|-------------|-----------------|-----------|----------|
| `openai` | OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` | AGT openai / Cline openai |
| `deepseek` | DeepSeek（兼容面） | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | 与 `@xrkseek/llm-deepseek` defaults 对齐；**非** thinking 官方加深 |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | Cline 长尾 |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | Cline |
| `fireworks` | Fireworks | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` | Cline |
| `together` | Together | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` | 常见网关 |
| `github-models` | GitHub Models | `https://models.inference.ai.azure.com` | `GITHUB_TOKEN` | Cline 生态；以官方文档为准再锁 URL |
| `ollama` | Ollama（OpenAI 兼容端口） | `http://127.0.0.1:11434/v1` | （常无） | AGT ollama_compat 的 **简易** 入口；完整行为 P1 `llm-ollama` |
| `azure-openai` | Azure OpenAI（简易） | （必填，无全局默认） | `AZURE_OPENAI_API_KEY` | authMode=`api-key`；deployment 进 path——**完整**走 P1 |
| `newapi` | New API | （自建，必填） | `NEWAPI_API_KEY` | AGT newapi_compat |
| `cherryin` | CherryIN | （自建，必填） | `CHERRYIN_API_KEY` | AGT cherryin_compat |
| `custom` | Custom OpenAI-compatible | （必填） | `OPENAI_API_KEY` | 万能槽 |

> URL 以各厂商当前文档为准；实现时用测例锁字符串，文档与代码同步。

## Host / CLI（P0 接线意向）

- env 例：`XRK_LLM_PRESET=openrouter` + `XRK_LLM_MODEL=…` + 对应 `*_API_KEY`  
- `createServerAgentFactory` / serve：按 preset 构造 adapter（仍禁止 server 包依赖具体厂商实现细节以外的 SDK——通过 presets/llm 包）  
- `provider.use`：adapter `id` 用 preset id（lc14）

## 不在本表

| 能力 | 去向 |
|------|------|
| Anthropic Messages 官方 | P1 `llm-anthropic` |
| Gemini 官方 | P1 `llm-gemini` |
| OpenAI Responses / 火山 | P1 `llm-openai-responses` |
| DeepSeek SSE/thinking | P2 加深 `llm-deepseek` |
| Cline 上百 generated id | 用户用 `custom` + baseUrl，或后续「别名表」扩展本文件 |

## 实现勾选（须满足 lc18 R0）

- [ ] Registry：`resolve` / `getProviderConfig` / `createAdapter` / `listForUi`  
- [ ] BrandEntries 数据 + 测例锁 URL/authMode/path  
- [ ] Host/CLI/`provider.use` 只走 Registry  
- [ ] Face `llm.providers` 投影同一表（Host Face U1）  
- [x] 规格真源：`llm-provider-registry.md`  
- [x] 实现计划：[superpowers/plans/2026-08-15-llm-provider-registry-r0.md](./superpowers/plans/2026-08-15-llm-provider-registry-r0.md)  

## Related

- [learn/provider-registry.md](./learn/provider-registry.md)  
- [learn/provider-matrix.md](./learn/provider-matrix.md)  
- [llm-openai-compatible.md](./llm-openai-compatible.md)  
- [llm-deepseek.md](./llm-deepseek.md)
