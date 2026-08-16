# LLM Provider Brand Entries

从属 [llm-provider-registry.md](./llm-provider-registry.md)。条目数据，不是产品终点：对外走 **ProviderRegistry** `resolve` → `create`。

## BrandEntries（OpenAI Chat · R0）

| id | displayName | baseUrl（默认） | apiKeyEnv |
|----|-------------|-----------------|-----------|
| `openai` | OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `deepseek` | DeepSeek | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `fireworks` | Fireworks | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `together` | Together | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| `github-models` | GitHub Models | `https://models.inference.ai.azure.com` | `GITHUB_TOKEN` |
| `ollama` | Ollama（兼容口） | `http://127.0.0.1:11434/v1` | （常无） |
| `azure-openai` | Azure OpenAI（简易） | （必填） | `AZURE_OPENAI_API_KEY` |
| `newapi` | New API | （自建） | `NEWAPI_API_KEY` |
| `cherryin` | CherryIN | （自建） | `CHERRYIN_API_KEY` |
| `custom` | Custom | （必填） | `OPENAI_API_KEY` |

URL 以厂商文档为准；测例锁字符串。

## 不在 R0

Anthropic Messages · Gemini 官方 · OpenAI Responses · DeepSeek thinking 加深 → 后续协议包。

## 相关

[llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md)
