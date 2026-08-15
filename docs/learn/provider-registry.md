# Provider Registry（深读 · lc18）

> **调研。** 用户锁定：供应商侧也不要「薄预设表糊弄」；要对齐 AGT **工厂分辨** 级自由度，再自研。  
> 全景清单：[provider-matrix.md](./provider-matrix.md) · 旧 P0 表升级入口：[../llm-provider-presets.md](../llm-provider-presets.md)

---

## 0. 立场

| 薄实现（否） | 最强轨（要） |
|--------------|--------------|
| 只有几个 `baseUrl` 常量 | **Registry**：builtin 协议包 vs compat 工厂 vs 品牌条目三层可解析 |
| `createOpenAiCompatibleAdapter({ baseUrl })` 散落 | `resolveProvider` → `getProviderConfig` → `createClient` 单路径 |
| 品牌 = 新 npm 包 | 品牌 = registry **条目**；协议分叉 = **包** |
| 忽略 overflow / path / auth | 协议包吃透错误码、path、authMode、passback（lc11） |

---

## 1. AGT 精华（`XRK-AGT` · `LLMFactory.js`）

### 1.1 两层工厂

- **builtin：** 官方协议路径（volcengine / deepseek / openai / gemini / anthropic / azure_openai / xiaomimimo）— **禁止与 openai_compat 混用冒充**  
- **compat：** `openai_compat` · `openai_responses_compat` · `newapi` · `cherryin` · `ollama` · `gemini_compat` · `anthropic_compat` · `azure_openai_compat`

每行工厂：`configKey` · `factoryType` · `defaultProtocol` · `clientClass`。

### 1.2 分辨链（精华）

`resolveProvider(input)` 候选顺序：`provider` → `model` → `llm` → `profile` → `defaultProvider` →（可选）全局默认。  
跳过 `default`/`auto` 别名除非显式允许。  
`getProviderConfig` 合并 YAML 条目 + `protocol` + `factoryType` + `_clientClass`。  
`createClient`：compat → 对应 Compat 类；builtin → `builtinClientFactories.get(protocol)`。

### 1.3 取 / 弃

**取：** builtin≠compat 纪律；单分辨入口；YAML `providers[]` 长尾不建包；侧栏工厂 id 与 configKey 映射。  

**弃/慎：** 把 AGT YAML 运行时整棵搬进本仓；无测例假官方客户端。

---

## 2. DeepSeek / Cline 对照（摘要）

| 源 | 精华 |
|----|------|
| DeepSeek | 官方包加深（SSE/thinking）；pi-ai 发现；与 UI `llm.*` RPC 对齐 |
| Cline | 超长 generated provider id → **配置/别名**，不建包洪流 |

---

## 3. 本仓最强形状（规格意向 · 未编码）

```text
ProviderRegistry
  ├─ ProtocolAdapters   (@xrkseek/llm-openai-compatible | anthropic | …)
  ├─ CompatFactories      (openai-chat | openai-responses | anthropic-compat | …)
  └─ BrandEntries         (openrouter, groq, deepseek-chat, newapi, …)
         └─ { factory, baseUrl?, authMode?, path?, apiKeyEnv, notes }

resolve(id | { provider, model }) → ProviderBinding
createAdapter(binding, secrets) → LlmAdapter
listForUi() → llm.providers / session.models 投影
```

- Host/CLI/`provider.use` **只**走 `resolve`（lc14）。  
- Face `llm.providers` / `discoverModels` 读同一 registry。  
- [llm-provider-presets.md](../llm-provider-presets.md) = **BrandEntries 初表**，从属 registry，不是终点。

### 分期（与 matrix 对齐，但标准更高）

| 阶段 | 交付 |
|------|------|
| **R0** | Registry API + openai-chat factory + BrandEntries 测例锁 URL/auth；host 选路 |
| **R1** | Anthropic / Gemini / Azure / Responses / Ollama **真协议包**（学官方客户端后） |
| **R2** | DeepSeek 官方加深 |
| **R3** | discoverModels；别名表覆盖 Cline 长尾 |

R0 **禁止**只导出常量表而无 `resolve`/`create` 单路径。

---

- [ ] 编码前再读 AGT 各一 builtin/compat 客户端（R1 闸门）  
- [x] 规格 `llm-provider-registry.md`  
- [x] 与 Face `llm.*` 对齐写入 registry 规格 §5  
- [ ] 测例：registry 分辨 + 每协议 mock HTTP（实现时）  

---

## 5. 参考

- AGT：`src/factory/llm/LLMFactory.js`  
- 本仓：lc11 · lc16 · [../llm-openai-compatible.md](../llm-openai-compatible.md)
