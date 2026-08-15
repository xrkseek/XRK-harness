# LLM Provider Registry（规格 · 最强轨）

> **产品契约草案。** 实现未开。对齐 AGT `LLMFactory` 分辨纪律；自研进本仓。  
> 学习：[learn/provider-registry.md](./learn/provider-registry.md) · [learn/provider-matrix.md](./learn/provider-matrix.md) · BrandEntries 初表：[llm-provider-presets.md](./llm-provider-presets.md)

## 1. 目标

单路径：

```text
resolve(input) → ProviderBinding → createAdapter(binding, secrets) → LlmAdapter
listForUi() / catalog() → Face `llm.providers` · `session.models`
```

- Host / CLI / `provider.use` / Face **只**走 Registry。  
- **builtin 协议包** ≠ **compat 工厂** ≠ **品牌条目**；禁止用 openai-chat 冒充官方 Anthropic/Gemini。  
- 密钥仅运行时注入；不入库。

包名意向：`@xrkseek/llm-registry`（或先放 `llm` 元包再拆）——依赖 `@xrkseek/llm` 接口与各协议适配包；**apps/server 不直依赖厂商 SDK**。

## 2. 核心类型（草案）

```ts
type ProtocolId =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "gemini"
  | "azure-openai"
  | "ollama"
  | "deepseek-official"; // R2

type FactoryKind = "builtin" | "compat";

interface BrandEntry {
  id: string;                 // openrouter, groq, …
  displayName: string;
  factory: ProtocolId;        // 通常 openai-chat
  baseUrl?: string;           // 缺省则创建时必填
  path?: string;
  authMode?: "bearer" | "api-key";
  apiKeyEnv?: string;
  defaultModel?: string;
  notes?: string;
}

interface ProviderBinding {
  provider: string;           // 路由键（品牌 id 或用户命名）
  protocol: ProtocolId;
  factoryKind: FactoryKind;
  model?: string;
  baseUrl: string;
  path: string;
  authMode: "bearer" | "api-key";
  // 无密钥字段
}

interface ProviderRegistry {
  registerBrand(entry: BrandEntry): void;
  registerProtocol(protocol: ProtocolId, factory: ProtocolFactory): void;
  resolve(input: ResolveInput): ProviderBinding;
  createAdapter(binding: ProviderBinding, secrets: { apiKey?: string }): LlmAdapter;
  listBrands(): readonly BrandEntry[];
  listRoutable(): readonly { id: string; displayName: string; active: boolean }[];
  catalog(signal?: AbortSignal): Promise<ModelCatalog>; // groups + failures
}
```

`ResolveInput` 候选序（学 AGT）：`provider` → `model`（若可解析为路由）→ `llm` → `profile` → `defaultProvider` → 环境默认（`XRK_LLM_PRESET`）。  
跳过字面量 `default` / `auto` 除非 `allowDefaultAliases`。

分辨失败 → 抛明确错误（提示配置 BrandEntries / 协议包），不静默落到错误供应商。

## 3. R0 交付范围

| 项 | 要求 |
|----|------|
| Protocol | 仅 `openai-chat` → 现有 `@xrkseek/llm-openai-compatible`（或等价） |
| Brands | [llm-provider-presets.md](./llm-provider-presets.md) 表；测例锁 baseUrl/authMode/path |
| API | `resolve` · `createAdapter` · `listBrands` · `listRoutable` |
| Host | `XRK_LLM_PRESET` + `XRK_LLM_MODEL` + 对应 `*_API_KEY` |
| Policy | `provider.use` 的 id = `binding.provider` |
| Face | `llm.providers` / `session.models` 读 `listRoutable` + 静态/配置模型列表（discover 属 R3） |

R0 **禁止**：只有 `OPENAI_COMPAT_PRESETS` 导出而无 Registry；server 包 import 厂商 SDK。

## 4. R1+（摘要）

| 阶段 | 协议包 |
|------|--------|
| R1 | anthropic-messages · gemini · azure-openai · openai-responses · ollama |
| R2 | deepseek-official（SSE/thinking/passback，lc11） |
| R3 | `discoverModels`；Cline 长尾别名表 |

每协议包：mock HTTP 测例 + docs + SDK 导出；overflow → `ContextOverflowError`。

## 5. 与 Face 字段对齐

| Face | Registry |
|------|----------|
| `ConfigurableProviderView.provider` | brand id / route key |
| `displayName` | BrandEntry.displayName |
| `active` | 协议 factory 已注册且密钥策略满足（或显式 dormant） |
| `settingsNs` / `settingsPath` | U2 settings 面再填；R0 可空数组 + 文档 |
| `session.models.current` | session 绑定的 binding |
| `session.models.routable` | `createAdapter` 当前可成功构造（有密钥或本地无密钥如 ollama） |
| `groups` / `failures` | catalog() |

## 6. 测例

- 分辨：显式 provider、仅 default、未知 provider  
- 每 BrandEntry 快照 baseUrl/authMode/path  
- createAdapter 调 mock server 一轮 chat  
- builtin 未注册时 resolve 到 anthropic 品牌不得落到 openai-chat 静默成功（R1 闸门）

## 7. 实现勾选

- [x] 包 + 类型 + 测例（R0）  
- [x] BrandEntries 数据模块  
- [x] Host/CLI 接线（`XRK_LLM_PRESET` via `resolveLlmFromEnv`）  
- [ ] Face `llm.*` / `session.models`（随 Host Face U1）  
- [x] status / SDK README  

## Related

- [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md) · [host-face.md](./host-face.md) · [policy.md](./policy.md)
