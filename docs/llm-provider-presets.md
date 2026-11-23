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
| `commandcode` | Command Code | `https://api.commandcode.ai/provider/v1` | `COMMANDCODE_API_KEY` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `fireworks` | Fireworks | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `together` | Together | `https://api.together.ai/v1` | `TOGETHER_API_KEY` |
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
| `zai` | Z.AI | `https://api.z.ai/api/coding/paas/v4` | `ZHIPU_API_KEY` |
| `zai-coding-cn` | Z.AI Coding CN | `https://open.bigmodel.cn/api/coding/paas/v4` | `ZAI_CODING_CN_API_KEY` |
| `zhipuai` | Zhipu AI | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |
| `ant-ling` | Ant Ling | `https://api.ant-ling.com/v1` | `ANT_LING_API_KEY` |
| `kimi-coding` | Kimi For Coding | `https://api.kimi.com/coding/v1` | `KIMI_API_KEY` |
| `qwen-token-plan` | Qwen Token Plan | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_TEAM_API_KEY` |
| `qwen-token-plan-cn` | Qwen Token Plan CN | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_TEAM_CN_API_KEY` |
| `qwen-token-plan-individual` | Qwen Token Plan Individual | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_INDIVIDUAL_API_KEY` |
| `qwen-token-plan-individual-cn` | Qwen Token Plan Individual CN | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_INDIVIDUAL_CN_API_KEY` |
| `xiaomi` | Xiaomi | `https://api.xiaomimimo.com/v1` | `XIAOMI_API_KEY` |
| `xiaomi-token-plan-cn` | Xiaomi Token Plan CN | `https://token-plan-cn.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| `xiaomi-token-plan-ams` | Xiaomi Token Plan AMS | `https://token-plan-ams.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` |
| `xiaomi-token-plan-sgp` | Xiaomi Token Plan SGP | `https://token-plan-sgp.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` |
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

**与 `@earendil-works/pi-ai` 的关系**：添加供应商清单是本仓 `OPENAI_CHAT_BRANDS` / `R1_PROTOCOL_BRANDS` **硬编码**（对照 pi-ai 1.6.0 的 openai-completions 面手工同步），**不是**运行时 import pi 的 `models.generated`。升 pi stub 版本不会自动改这张表；发现新品牌时改 `packages/llm/registry/src/brands-openai-chat.ts` + 测例 + 本文。models.dev 只在发现模型时填空字段。

`opencode`（Zen）密钥：`OPENCODE_API_KEY`（https://opencode.ai/zen）。`opencode-go` 密钥：`OPENCODE_GO_API_KEY`（环境变量可回退 `OPENCODE_API_KEY`）。Zen / Go 出站按 [Go 文档](https://opencode.ai/docs/go/) 带稳定 `x-opencode-session`（兼 `x-session-id`）与产品 `User-Agent`；Custom 指到 `opencode.ai/zen` / `inference` 时同样识别。

`commandcode` 密钥：`COMMANDCODE_API_KEY`（可回退 `CMD_API_KEY`；[Provider API](https://commandcode.ai/docs/provider-api)，GOAT+）。出站只带稳定 `x-session-id`（**不**发 `x-opencode-session`）；可选 ZDR 用额外头 `x-cmd-zdr: 1`。Custom 指到 `commandcode.ai` 时同样识别。

前缀系列走协议级 `conversationUpdates`（openai-chat / responses / anthropic → `systemPromptUpdate: in-history`）。`toolUpdate` **仅**在 `anthropic-messages` 上生效（Chat Completions 目录声明会被丢掉）。有会话 id 时：通用 / Custom / 中转出站 `x-session-id`；Responses 协议另写会话级 `prompt_cache_key`（[OpenAI Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching)）。Chat Completions **不**洒 `prompt_cache_key`。

部分 OpenCode 免费模型有地区或「仅 OpenCode 客户端」限制，403 会标成 `REGION` / `PROVIDER_DENIED`，UI 展示真因而非 invalid key。

非 openai-chat 网关（如 Bedrock / Vertex）用 Custom 自填 endpoint。

## BrandEntries（官方协议 · R1）

| id | protocol | baseUrl（默认） | apiKeyEnv |
|----|----------|-----------------|-----------|
| `anthropic` | `anthropic-messages` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `deepseek-messages` | `anthropic-messages` | `https://api.deepseek.com/anthropic` | `DEEPSEEK_API_KEY` |
| `gemini` | `gemini-generate` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |
| `openai-responses` | `openai-responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |

`deepseek-messages` 走官方 Anthropic 兼容 Messages 口；Flash 目录声明 `toolUpdate: addition-only`（`defer_loading` + system `tool_addition`）。默认品牌 `deepseek` 仍是 Chat Completions（只靠 `tools-baseline` 尾追加，**不**发 Messages 专用字段）。

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
| `commandcode` | Command Code | `https://api.commandcode.ai/provider/v1` | `COMMANDCODE_API_KEY` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `fireworks` | Fireworks | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `together` | Together | `https://api.together.ai/v1` | `TOGETHER_API_KEY` |
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
| `zai` | Z.AI | `https://api.z.ai/api/coding/paas/v4` | `ZHIPU_API_KEY` |
| `zai-coding-cn` | Z.AI Coding CN | `https://open.bigmodel.cn/api/coding/paas/v4` | `ZAI_CODING_CN_API_KEY` |
| `zhipuai` | Zhipu AI | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |
| `ant-ling` | Ant Ling | `https://api.ant-ling.com/v1` | `ANT_LING_API_KEY` |
| `kimi-coding` | Kimi For Coding | `https://api.kimi.com/coding/v1` | `KIMI_API_KEY` |
| `qwen-token-plan` | Qwen Token Plan | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_TEAM_API_KEY` |
| `qwen-token-plan-cn` | Qwen Token Plan CN | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_TEAM_CN_API_KEY` |
| `qwen-token-plan-individual` | Qwen Token Plan Individual | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_INDIVIDUAL_API_KEY` |
| `qwen-token-plan-individual-cn` | Qwen Token Plan Individual CN | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_INDIVIDUAL_CN_API_KEY` |
| `xiaomi` | Xiaomi | `https://api.xiaomimimo.com/v1` | `XIAOMI_API_KEY` |
| `xiaomi-token-plan-cn` | Xiaomi Token Plan CN | `https://token-plan-cn.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| `xiaomi-token-plan-ams` | Xiaomi Token Plan AMS | `https://token-plan-ams.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` |
| `xiaomi-token-plan-sgp` | Xiaomi Token Plan SGP | `https://token-plan-sgp.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` |
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

**Relation to `@earendil-works/pi-ai`**: the add-provider directory is this repo's hardcoded `OPENAI_CHAT_BRANDS` / `R1_PROTOCOL_BRANDS` (manually synced against pi-ai 1.6.0 openai-completions providers). Bumping the pi stub does **not** auto-update this table — edit `packages/llm/registry/src/brands-openai-chat.ts` + tests + this doc. models.dev only fills blank capacity fields at discovery time.

`opencode` (Zen) key: `OPENCODE_API_KEY` (https://opencode.ai/zen). `opencode-go` key: `OPENCODE_GO_API_KEY` (env may fall back to `OPENCODE_API_KEY`). Zen and Go outbound follow the [Go docs](https://opencode.ai/docs/go/): a stable `x-opencode-session` (plus `x-session-id`) and a product `User-Agent`; custom bases under `opencode.ai/zen` / `inference` are detected the same way.

`commandcode` key: `COMMANDCODE_API_KEY` (env may fall back to `CMD_API_KEY`; [Provider API](https://commandcode.ai/docs/provider-api), GOAT+). Outbound sends a stable `x-session-id` only (**never** `x-opencode-session`); optional ZDR via extra header `x-cmd-zdr: 1`. Custom bases under `commandcode.ai` are detected the same way.

Prefix series uses protocol-level `conversationUpdates` (openai-chat / responses / anthropic → `systemPromptUpdate: in-history`). `toolUpdate` applies **only** on `anthropic-messages` (Chat Completions catalog flags are dropped). With a harness session id: generic / Custom / relay outbound gets `x-session-id`; Responses also sets a session-scoped `prompt_cache_key` ([OpenAI Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching)). Chat Completions does **not** sprinkle `prompt_cache_key`.

Some OpenCode free models are geo- or client-restricted — those 403s map to `REGION` / `PROVIDER_DENIED`, and the UI shows the real cause instead of a fake invalid-key AUTH.

Gateways outside openai-chat (e.g. Bedrock / Vertex) use Custom with a self-supplied endpoint.

## BrandEntries (official protocols · R1)

| id | protocol | baseUrl (default) | apiKeyEnv |
|----|----------|-------------------|-----------|
| `anthropic` | `anthropic-messages` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `deepseek-messages` | `anthropic-messages` | `https://api.deepseek.com/anthropic` | `DEEPSEEK_API_KEY` |
| `gemini` | `gemini-generate` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |
| `openai-responses` | `openai-responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |

`deepseek-messages` uses the official Anthropic-compatible Messages endpoint; Flash declares `toolUpdate: addition-only`. The default `deepseek` brand remains Chat Completions (`tools-baseline` only — no Messages-only fields).

`openai-completions` is a Chat Completions factory alias (settings UI name); it is not the legacy Completions text API. Custom gateways may set any brand’s `api` to one of the protocols above.

## Related

[llm-provider-registry.md](./llm-provider-registry.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md)
