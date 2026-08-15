# OpenAI-compatible / DeepSeek LLM（深读 · lc11）

> **调研笔记。** 产品 API 以 [../llm-openai-compatible.md](../llm-openai-compatible.md) · [../llm-deepseek.md](../llm-deepseek.md) · [../status.md](../status.md) 为准。  
> 本仓已有薄实现；本文补齐「写之前该学什么」——对齐 [mcp-protocol.md](./mcp-protocol.md) 的深读标准。

---

## 0. 立场

| 原则 | 含义 |
|------|------|
| 真源分层 | **Wire**：OpenAI Chat Completions 形态网关；**厂商语义**：DeepSeek 官方文档 / DeepSeek Harness adapter；**网关怪癖**：AGT `openai-chat-utils` |
| 本仓已交付 | 非流式 `createOpenAiCompatibleAdapter` + `createDeepSeekAdapter`（**仅 defaults**） |
| 诚实命名 | `@xrkseek/llm-deepseek` ≠ DeepSeek 官方完整适配；thinking/SSE/错误码 **未做** |
| 取精华 | 分层序列化、稳定错误码、凭据引用、reasoning passback、token 字段双写 |
| 去糟粕 | 把 defaults 包装成「官方适配」；仅靠正文子串判 overflow；坏 JSON args 静默 `{_raw}` 当长期方案 |
| 未学完不扩 | 上 SSE / thinking / 重试策略前勾选 §8 |

---

## 1. 本仓已落地（事实）

| 包 | 行为 |
|----|------|
| `@xrkseek/llm` | `chat()` → `{ content, toolCalls? }`；`ContextOverflowError` |
| `openai-compatible` | 非流式：endpoint 拼接、bearer/api-key/header、messages/tools、缺 id 兜底、400/413+关键词 → overflow、可选 `timeoutMs` |
| `llm-deepseek` | `baseUrl=https://api.deepseek.com` · `model=deepseek-chat`；委托 compat |

测例：mock `fetch`；无真实密钥。

---

## 2. 上游深读

### 2.1 XRK-AGT（网关现实）

路径：`XRK-AGT/src/factory/llm/OpenAICompatibleLLMClient.js` · `…/utils/llm/openai-chat-utils.js`；另有独立 `DeepSeekLLMClient.js`（**不是** compat 套壳）。

| 吸取 | 细节 |
|------|------|
| SSE + 空流检测 | 流式是产品默认路径之一 |
| Vision / data-URL | 多模态消息形状 |
| `stripToolTraces` | **配置开关**，不是写死某模型 |
| Proxy / 自定义 fetch | 企业网关 |
| Token 字段 | 部分厂商要 `max_completion_tokens`（如 MiMo 注释）并与 `max_tokens` 双写 |
| Tool 多轮 | 与 MCP adapter 耦合的 partition/execute（本仓用 loop+registry，不搬这层） |

**不取：** Cordis、把 tool loop 塞进 LLM client、并 AGT 源码。

### 2.2 DeepSeek Harness `llm-deepseek`（大厂官方路径）

路径：`deepseek-harness/packages/llm/llm-deepseek/`（`adapter.ts` · `sse.ts` · `serialize.ts` · `translate.ts` · README）。

| 吸取 | 细节 |
|------|------|
| **流式优先** | SSE + idle watchdog；usage 与 finish 顺序纪律 |
| **Thinking / effort** | 部署锁 `thinking`；`reasoning_effort`；`off` → `thinking.type: disabled`（勿把 `off` 当 wire 字符串） |
| **Reasoning passback** | **带 tool_calls 的 assistant 轮**必须回传 `reasoning_content`；无 tool 轮可丢（省 token） |
| **错误码** | `AUTH` / `QUOTA` / `RATE_LIMIT` / `CONTEXT_WINDOW_EXCEEDED` / `TIMEOUT` / `ABORTED` / … + Retry-After |
| **凭据** | 配置只存 `apiKeyEnv`；**每次请求** resolve；字面 key 不进配置 |
| **目录 vs pass-through** | catalog 可浏览；未列 model id 仍可直通 |
| **归因头** | User-Agent / session 匿名 id（产品化细节，本仓可后置） |
| 与 pi-ai 双路径 | `deepseek-official` vs catalog `deepseek` 故意分名 |

**不取：** Cordis plugin、Effect、整包 retry 运行时拓扑（可学边界：retry 在 agent-step，不在单次 fetch 里无限套）。

### 2.3 Cline / OpenCode（侧视）

- Cline：厚 provider 栈 + **toolPolicies / approval** —— 与 wire 正交，学「审批在 runtime 一等公民」。  
- OpenCode：`provider-model` / `provider-policy` —— **可用性 ≠ 凭据**；目录与策略分层。

---

## 3. 本仓糟粕 / 捷径（已在树里 · 承认）

| 项 | 风险 |
|----|------|
| DeepSeek 包仅 defaults | 文档/status 易被读成「官方适配」 |
| Overflow 子串启发式 | 不如 provider `code`/`type` 稳定 |
| 仅非流式 | 日后 SSE 可能二次改写 message/tool 映射 |
| 坏 `arguments` → `{ _raw }` | 对模型往返不诚实；AGT/DeepSeek 更倾向保留 raw string |
| lc11 旧笔记过短 | 已导致「未深读就薄实现」 |

---

## 4. 分层建议（学完再改代码）

```text
LlmAdapter 缝
  ├─ openai-compatible：网关通用 wire（auth · endpoint · tools · 错误粗分）
  ├─ llm-deepseek（未来真适配）：官方 SSE · thinking · 错误码 · passback
  └─ replay：测例
```

不要：在 compat 里堆 `thinking` 特例；不要：再发明第三套 message 映射。

---

## 5. 吸收清单（扩能力前勾选）

- [ ] 错误码矩阵（至少 overflow / auth / rate-limit）与 loop compaction 对齐  
- [ ] `arguments` 解析策略：raw string vs parse（文档+测例锁死）  
- [ ] SSE 形状是否进入 `@xrkseek/llm`（`chat` vs `stream`）——先改契约再写  
- [ ] DeepSeek thinking：单独切片；含 passback 规则测例  
- [ ] 凭据：env 名 / 每请求 resolve（勿构造时冻死 key）  
- [ ] `max_tokens` vs `max_completion_tokens` 配置项  
- [ ] `stripToolTraces` 是否需要（有网关证据再做）  
- [ ] 文档：status 对 `llm-deepseek` 标注「defaults only」直到真适配  

---

## 6. 参考

- 本仓实现：`packages/llm/openai-compatible` · `packages/llm/deepseek`  
- AGT：`OpenAICompatibleLLMClient.js` · `DeepSeekLLMClient.js` · `openai-chat-utils.js`  
- DeepSeek Harness：`packages/llm/llm-deepseek/README(.zh).md`  
- 规格产品：[../llm-openai-compatible.md](../llm-openai-compatible.md)
