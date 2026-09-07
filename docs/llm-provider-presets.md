# LLM Provider Brand Entries

> **读者**：贡献者 · 维护者

从属 [llm-provider-registry.md](./llm-provider-registry.md)。条目数据，不是产品终点：对外走 **ProviderRegistry** `resolve` → `create`。

## BrandEntries（OpenAI Chat · R0）

| id | displayName | baseUrl（默认） | apiKeyEnv |
|----|-------------|-----------------|-----------|
| `openai` | OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `deepseek` | DeepSeek | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `opencode` | OpenCode Zen | `https://opencode.ai/zen/v1` | `OPENCODE_API_KEY` |
| `opencode-go` | OpenCode Go | `https://opencode.ai/zen/go/v1` | `OPENCODE_GO_API_KEY` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `fireworks` | Fireworks | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `together` | Together | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| `github-models` | GitHub Models | `https://models.inference.ai.azure.com` | `GITHUB_TOKEN` |
| `xai` | xAI | `https://api.x.ai/v1` | `XAI_API_KEY` |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| `cerebras` | Cerebras | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEY` |
| `deepinfra` | Deep Infra | `https://api.deepinfra.com/v1/openai` | `DEEPINFRA_API_KEY` |
| `novita-ai` | NovitaAI | `https://api.novita.ai/openai` | `NOVITA_API_KEY` |
| `siliconflow` | SiliconFlow | `https://api.siliconflow.com/v1` | `SILICONFLOW_API_KEY` |
| `siliconflow-cn` | SiliconFlow (China) | `https://api.siliconflow.cn/v1` | `SILICONFLOW_CN_API_KEY` |
| `moonshotai` | Moonshot AI | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` |
| `moonshotai-cn` | Moonshot AI (China) | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `minimax` | MiniMax (minimax.io) | `https://api.minimax.io/v1` | `MINIMAX_API_KEY` |
| `minimax-cn` | MiniMax (minimaxi.com) | `https://api.minimaxi.com/v1` | `MINIMAX_API_KEY` |
| `zai` | Z.AI | `https://api.z.ai/api/paas/v4` | `ZHIPU_API_KEY` |
| `zhipuai` | Zhipu AI | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |
| `perplexity` | Perplexity | `https://api.perplexity.ai` | `PERPLEXITY_API_KEY` |
| `huggingface` | Hugging Face | `https://router.huggingface.co/v1` | `HF_TOKEN` |
| `nvidia` | Nvidia | `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY` |
| `baseten` | Baseten | `https://inference.baseten.co/v1` | `BASETEN_API_KEY` |
| `vercel` | Vercel AI Gateway | `https://ai-gateway.vercel.sh/v1` | `AI_GATEWAY_API_KEY` |
| `aihubmix` | AIHubMix | `https://aihubmix.com/v1` | `AIHUBMIX_API_KEY` |
| `ollama` | Ollama（兼容口） | `http://127.0.0.1:11434/v1` | （常无） |
| `lmstudio` | LM Studio | `http://127.0.0.1:1234/v1` | （常无） |
| `azure-openai` | Azure OpenAI（简易） | （必填） | `AZURE_OPENAI_API_KEY` |
| `newapi` | New API | （自建） | `NEWAPI_API_KEY` |
| `cherryin` | CherryIN | （自建） | `CHERRYIN_API_KEY` |
| `custom` | Custom | （必填） | `OPENAI_API_KEY` |

URL 以厂商文档为准；测例锁字符串。Settings 添加目录来自 Registry（经 `llm.providers`）；`llm-pi-ai` settings base 仅含零配置 `ollama`。

`opencode`（Zen）密钥：`OPENCODE_API_KEY`（https://opencode.ai/zen）。`opencode-go` 密钥：`OPENCODE_GO_API_KEY`（环境变量可回退 `OPENCODE_API_KEY`）。

非 openai-chat 网关（如 Bedrock / Vertex）用 Custom 自填 endpoint。

## BrandEntries（官方协议 · R1）

| id | protocol | baseUrl（默认） | apiKeyEnv |
|----|----------|-----------------|-----------|
| `anthropic` | `anthropic-messages` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `gemini` | `gemini-generate` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |
| `openai-responses` | `openai-responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |

`openai-completions` 是 Chat Completions 工厂别名（settings UI 名）；不是 legacy Completions 文本接口。自定义网关可把任意 brand 的 `api` 改成上表协议之一。

## 相关

[llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md)

---

# LLM Provider Brand Entries

> **Audience**: Contributors · Maintainers

Subordinate to [llm-provider-registry.md](./llm-provider-registry.md). Entry data is not the product endpoint: external callers use **ProviderRegistry** `resolve` → `create`.

## BrandEntries (OpenAI Chat · R0)

| id | displayName | baseUrl (default) | apiKeyEnv |
|----|-------------|-------------------|-----------|
| `openai` | OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `deepseek` | DeepSeek | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `opencode` | OpenCode Zen | `https://opencode.ai/zen/v1` | `OPENCODE_API_KEY` |
| `opencode-go` | OpenCode Go | `https://opencode.ai/zen/go/v1` | `OPENCODE_GO_API_KEY` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `fireworks` | Fireworks | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `together` | Together | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| `github-models` | GitHub Models | `https://models.inference.ai.azure.com` | `GITHUB_TOKEN` |
| `xai` | xAI | `https://api.x.ai/v1` | `XAI_API_KEY` |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| `cerebras` | Cerebras | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEY` |
| `deepinfra` | Deep Infra | `https://api.deepinfra.com/v1/openai` | `DEEPINFRA_API_KEY` |
| `novita-ai` | NovitaAI | `https://api.novita.ai/openai` | `NOVITA_API_KEY` |
| `siliconflow` | SiliconFlow | `https://api.siliconflow.com/v1` | `SILICONFLOW_API_KEY` |
| `siliconflow-cn` | SiliconFlow (China) | `https://api.siliconflow.cn/v1` | `SILICONFLOW_CN_API_KEY` |
| `moonshotai` | Moonshot AI | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` |
| `moonshotai-cn` | Moonshot AI (China) | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `minimax` | MiniMax (minimax.io) | `https://api.minimax.io/v1` | `MINIMAX_API_KEY` |
| `minimax-cn` | MiniMax (minimaxi.com) | `https://api.minimaxi.com/v1` | `MINIMAX_API_KEY` |
| `zai` | Z.AI | `https://api.z.ai/api/paas/v4` | `ZHIPU_API_KEY` |
| `zhipuai` | Zhipu AI | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |
| `perplexity` | Perplexity | `https://api.perplexity.ai` | `PERPLEXITY_API_KEY` |
| `huggingface` | Hugging Face | `https://router.huggingface.co/v1` | `HF_TOKEN` |
| `nvidia` | Nvidia | `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY` |
| `baseten` | Baseten | `https://inference.baseten.co/v1` | `BASETEN_API_KEY` |
| `vercel` | Vercel AI Gateway | `https://ai-gateway.vercel.sh/v1` | `AI_GATEWAY_API_KEY` |
| `aihubmix` | AIHubMix | `https://aihubmix.com/v1` | `AIHUBMIX_API_KEY` |
| `ollama` | Ollama (compat endpoint) | `http://127.0.0.1:11434/v1` | (often none) |
| `lmstudio` | LM Studio | `http://127.0.0.1:1234/v1` | (often none) |
| `azure-openai` | Azure OpenAI (simple) | (required) | `AZURE_OPENAI_API_KEY` |
| `newapi` | New API | (self-hosted) | `NEWAPI_API_KEY` |
| `cherryin` | CherryIN | (self-hosted) | `CHERRYIN_API_KEY` |
| `custom` | Custom | (required) | `OPENAI_API_KEY` |

URLs follow vendor docs; tests lock the strings. The Settings add directory comes from the Registry via `llm.providers`; the `llm-pi-ai` settings base ships only zero-config `ollama`.

`opencode` (Zen) key: `OPENCODE_API_KEY` (https://opencode.ai/zen). `opencode-go` key: `OPENCODE_GO_API_KEY` (env may fall back to `OPENCODE_API_KEY`).

Gateways outside openai-chat (e.g. Bedrock / Vertex) use Custom with a self-supplied endpoint.

## BrandEntries (official protocols · R1)

| id | protocol | baseUrl (default) | apiKeyEnv |
|----|----------|-------------------|-----------|
| `anthropic` | `anthropic-messages` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `gemini` | `gemini-generate` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |
| `openai-responses` | `openai-responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |

`openai-completions` is a Chat Completions factory alias (settings UI name); it is not the legacy Completions text API. Custom gateways may set any brand’s `api` to one of the protocols above.

## Related

[llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md)
