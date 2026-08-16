# Documentation

产品规格与决策真源。实现以代码 + [status.md](./status.md) 为准。

## 从哪读起

| 角色 | 顺序 |
|------|------|
| 集成 | [status.md](./status.md) → [architecture.md](./architecture.md) → [packages/sdk/README](../packages/sdk/README.md) → [session.md](./session.md) · [http-api.md](./http-api.md) |
| Host / CLI | [host-preset.md](./host-preset.md) · [profiles.md](./profiles.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md) |
| 工具 / exec | [tool-pipeline.md](./tool-pipeline.md) · [seams.md](./seams.md) · [tool-settlement.md](./tool-settlement.md) |
| 安全 | [security-checklist.md](./security-checklist.md) · [policy.md](./policy.md) |
| 贡献 | [../CONTRIBUTING.md](../CONTRIBUTING.md) · [testing.md](./testing.md) |
| 决策 | [adr/](./adr/README.md) |

## 规格索引

### Session / Host

| 文档 | 内容 |
|------|------|
| [session.md](./session.md) | Session 索引 |
| [protocol-events.md](./protocol-events.md) | 事件 · Schema |
| [session-api.md](./session-api.md) | newSession · admit · continueTurn |
| [session-delivery.md](./session-delivery.md) | steer / queue |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch |
| [session-safety.md](./session-safety.md) | mistake · loop |
| [session-compaction.md](./session-compaction.md) | compaction · overflow |
| [http-api.md](./http-api.md) | HTTP / SSE / env |
| [host-face.md](./host-face.md) | Host Face（RPC + 双 WS） |
| [host-preset.md](./host-preset.md) | Host vs preset |
| [profiles.md](./profiles.md) | Preset 选型 |
| [plugin-loader.md](./plugin-loader.md) | 插件 discover / load |

### LLM

| 文档 | 内容 |
|------|------|
| [llm-openai-compatible.md](./llm-openai-compatible.md) | OpenAI 兼容 Chat Completions |
| [llm-deepseek.md](./llm-deepseek.md) | DeepSeek API 预设 |
| [llm-provider-registry.md](./llm-provider-registry.md) | Provider Registry |
| [llm-provider-presets.md](./llm-provider-presets.md) | BrandEntries |

### Tools / Workspace

| 文档 | 内容 |
|------|------|
| [tool-pipeline.md](./tool-pipeline.md) | 工具瀑布 |
| [tool-settlement.md](./tool-settlement.md) | dangling · parallel settle |
| [tool-output-bound.md](./tool-output-bound.md) | 大结果 bound |
| [seams.md](./seams.md) | Definition / Provider / Consumer |
| [shell-jobs.md](./shell-jobs.md) | shell 后台 job |
| [code-mode.md](./code-mode.md) | `run_code` 实验面 |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` 注入 |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` |
| [policy.md](./policy.md) | tool / provider / mcp 门禁 |
| [compose.md](./compose.md) | `@xrkseek/compose` Scope / Ordering |

### Meta

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 包图 · 依赖 |
| [status.md](./status.md) | 能力矩阵 |
| [testing.md](./testing.md) | `pnpm check` |
| [security-checklist.md](./security-checklist.md) | 安全控制 |
| [publishing.md](./publishing.md) | 发包边界 |
| [learn.md](./learn.md) | 维护者笔记（极简） |

## 同步规则

1. 改公共契约 → 同 PR 更新对应 `docs/*`。  
2. 包 README 写导出与非目标；细节链到本目录。  
3. 空壳包必须标明 **empty shell**，禁止假 API。
