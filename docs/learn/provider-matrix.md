# 供应商矩阵与自由度（深读 · lc16）

> **调研 · 不搬仓 · 未实现全量适配。**  
> 用户目标：bar 经典智能体 + XRK-AGT 经典供应商 **全覆盖意向**；先完整学习再分期落地。  
> 产品真源仍以 [../status.md](../status.md) 为准；本仓现仅 `replay` · `openai-compatible` · `deepseek`(defaults)。

---

## 0. 立场

| 原则 | 含义 |
|------|------|
| 「全要」= 学习清单与分层目标，不是一夜写完所有厂商 SDK | 自由度来自 **协议族 + 预设**，不是 N 份复制粘贴 Client |
| AGT 纪律（精华） | **builtin（官方路径）禁止与 openai_compat 混用**；compat 族另册 |
| DeepSeek Harness 纪律 | `deepseek-official` 自研 SSE/thinking；其余走 **pi-ai catalog / 自宣网关** |
| Cline 纪律 | 海量 models.dev 派生 id + 手写 vendor（Anthropic/OpenAI/Google/Bedrock…）+ gateway 族 |
| 去糟粕 | 为每个网关品牌各写一包；假「官方」包实则只改 baseUrl；未学 wire 就开 SSE |
| UI | DeepSeek Web **另轨**（MIT 可引）；见 §6，不与供应商矩阵混为一谈 |

---

## 1. XRK-AGT 经典（权威本地清单）

来源：`XRK-AGT/src/factory/llm/LLMFactory.js` `factoryRegistry` + `builtinClientFactories`。

### 1.1 Builtin（官方路径 · 勿当纯 compat）

| protocol | 显示名 | 客户端 | 学习要点 |
|----------|--------|--------|----------|
| `volcengine` | 火山引擎（官方） | `VolcengineLLMClient` ← Responses 兼容基类 | Responses API 形态 |
| `deepseek` | DeepSeek（官方） | `DeepSeekLLMClient` | reasoning_effort / 流式 / 与 compat **分册** |
| `xiaomimimo` | 小米 MiMo（官方） | `XiaomiMiMoLLMClient` | `max_completion_tokens` 等字段 |
| `openai` | OpenAI（官方） | `OpenAILLMClient` | Chat Completions 官方 |
| `gemini` | Gemini（官方） | `GeminiLLMClient` | Google 原生协议 |
| `anthropic` | Anthropic（官方） | `AnthropicLLMClient` | Messages API · thinking · version 头 |
| `azure_openai` | Azure OpenAI（官方） | `AzureOpenAILLMClient` | deployment ≠ model 对外约定 |

### 1.2 Compat（网关 / 兼容面）

| configKey | 显示名 | 客户端 | 学习要点 |
|-----------|--------|--------|----------|
| `openai_compat_llm` | OpenAI Chat 兼容 | `OpenAICompatibleLLMClient` | 本仓已有薄吸收起点 |
| `openai_responses_compat_llm` | OpenAI Responses 兼容 | `OpenAIResponsesCompatibleLLMClient` | 与 Chat 分协议 |
| `newapi_compat_llm` | New API 兼容 | `OpenAIPathCompatLLMClient` | path 变体 |
| `cherryin_compat_llm` | CherryIN 兼容 | 同上 | path 变体 |
| `ollama_compat_llm` | Ollama 兼容 | `OllamaCompatibleLLMClient` | 本地 · 流式细节 |
| `gemini_compat_llm` | Gemini 兼容 | `GeminiCompatibleLLMClient` | 兼容网关非官方 SDK |
| `anthropic_compat_llm` | Anthropic 兼容 | `AnthropicCompatibleLLMClient` | 兼容 Messages 网关 |
| `azure_openai_compat_llm` | Azure OpenAI 兼容 | `AzureOpenAICompatibleLLMClient` | api-key / 部署路径 |

**AGT 精华：** `providers[]` 配置驱动；`assertProviderAllowed`；工厂 id 与 protocol 解耦。

---

## 2. DeepSeek Harness（bar 优先级 1）

| 包 | 角色 |
|----|------|
| `llm-deepseek` | **唯一**官方 DeepSeek 路由 `deepseek-official`（SSE · thinking · 错误码 · passback） |
| `llm-pi-ai` | **通用多提供方**：pi-ai catalog（openai / anthropic / deepseek / …）+ 自宣网关（`api: openai-completions \| openai-responses \| anthropic-messages`） |
| `llm-retry` / `token-meter` | 横切，非厂商 |

**自由度模型（精华）：**

```text
配置字典 providers:
  openai:     { apiKeyEnv, baseURL?, models? }     # catalog 继承
  anthropic:  { ... }
  my-gateway: { api: openai-completions, baseURL, apiKeyEnv }  # 自宣
请求: GenerateOptions.provider + model
```

- 新网关 = **加配置**，默认不改代码  
- 官方 DeepSeek 深度能力 = **独立包**，不塞进 pi-ai  
- 凭据只存 env 名；每请求 resolve  

**不取：** Cordis 插件形态原样；把本仓 LlmAdapter 一次性改成 StreamChunk 全家桶（可分期）。

---

## 3. Cline（bar 经典智能体 · 供应商面）

路径：`XRKbar/cline/sdk/packages/llms/src/providers/`。

| 层 | 内容 |
|----|------|
| 手写 vendor | `anthropic` · `openai` · `openai-compatible` · `google` · `bedrock` · `vertex` · `ollama` · `mistral` · `minimax-thinking` · community/SAP/Dify… |
| 生成 id | `provider-ids.generated.ts` — models.dev 派生 **上百** 个网关品牌（openrouter、groq、fireworks、alibaba、huggingface…） |
| 路由 | `routing/*` thinking / anthropic-compatible / generic-compatible |

**精华：** 「经典协议族少数 + 网关长尾配置化」；**糟粕风险：** 把 100+ id 各做成本仓 npm 包。

对本仓：**长尾全部映射到 compat 预设 + 文档化 baseUrl 模板**，只为协议分叉开包。

---

## 4. 本仓目标分层（学习后的架构意向）

```text
@xrkseek/llm                    # 缝（chat 今；stream 后）
├─ llm-replay
├─ llm-openai-compatible        # Chat Completions 通用（已有）
├─ llm-openai-responses         # Responses 族（学自 AGT/火山）【待】
├─ llm-anthropic                # Messages 官方+compat 配置面【待】
├─ llm-gemini                   # 官方+compat【待】
├─ llm-azure-openai             # deployment/api-version【待】
├─ llm-ollama                   # 本地【待】
├─ llm-deepseek                 # defaults→真官方（SSE/thinking）【待加深】
└─ presets / docs               # OpenRouter·Groq·NewAPI·CherryIN… = compat 配置，不单开包
```

**「全要」落点：**

| 类别 | 覆盖方式 |
|------|----------|
| AGT builtin 7 | 对应官方/专用包或加深现有包 |
| AGT compat 8 | openai-compatible / responses / anthropic / gemini / azure / ollama + path 预设 |
| Cline 长尾 | **配置模板 + 文档**，不建包洪流 |
| DeepSeek 官方深度 | 对齐 harness `llm-deepseek` 精华（见 lc11） |

---

## 5. 吸收清单（分期 · 勾选后再编码）

### P0 / R0 — Registry 骨架（非薄常量表）

- [x] 文档化「协议族 vs 品牌」表（本文 §4）  
- [x] 规格 [../llm-provider-registry.md](../llm-provider-registry.md)；BrandEntries → [../llm-provider-presets.md](../llm-provider-presets.md)  
- [ ] `resolve`→`create` 实现 + Host/CLI/`provider.use`  
- [x] Host Face 规格 [../host-face.md](../host-face.md)（U1 表）  

### P1 — AGT 官方协议族

- [ ] Anthropic Messages（学 `AnthropicLLMClient` + utils）  
- [ ] Gemini 官方（学 `GeminiLLMClient`）  
- [ ] Azure OpenAI（deployment / api-key）  
- [ ] OpenAI Responses + 火山作为 Responses 预设  
- [ ] Ollama compat  

### P2 — DeepSeek 官方加深

- [ ] SSE · thinking · passback · 稳定错误码（lc11 §5）  

### P3 — 长尾与发现

- [ ] `/models` 发现（可选，学 pi-ai discovery）  
- [ ] Xiaomi MiMo 等字段特例（按需）  

### 明确不做（防糟粕）

- [ ] 为 Cline 每个 generated id 建包  
- [ ] 并入 AGT/DeepSeek LLM 源码树  
- [ ] 无测例的「假官方」空壳  

---

## 6. UI 学习轨（与供应商并行 · MIT）

| 项 | 内容 |
|----|------|
| 来源 | DeepSeek Harness `apps/web` + `dsh-client-web*` 族；**MIT** Copyright DeepSeek |
| 策略 | **最强轨：** 完整 client 壳 + 本仓 **Host Face**（RpcMethodMap + 双 WS）；否决薄 React 壳 |
| ADR-0002 | MIT UI / npm；Cordis 仅浏览器组合；禁并入 agent kernel |
| 接缝 | Face 把 session 投影为 DeepSeek RPC/事件；见 lc17 |

UI：[deepseek-web-ui.md](./deepseek-web-ui.md)（lc17）· Registry：[provider-registry.md](./provider-registry.md)（lc18）。

---

## 7. 参考路径

- AGT：`src/factory/llm/LLMFactory.js` · 各 `*LLMClient.js` · `openai-chat-utils` / `anthropic-chat-utils`  
- DeepSeek：`packages/llm/llm-deepseek` · `llm-pi-ai`  
- Cline：`sdk/packages/llms/src/providers/`  
- 本仓：lc11 · lc14 · [../llm-openai-compatible.md](../llm-openai-compatible.md)
