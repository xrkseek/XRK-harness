# Documentation

生产规格与决策真源。**learn/** 是调研笔记，不是 API 契约——以本目录根下规格 + 代码为准。

## 按角色

| 角色 | 建议阅读序 |
|------|------------|
| **集成 SDK** | [status.md](./status.md) → [architecture.md](./architecture.md) → [packages/sdk/README](../packages/sdk/README.md) → [session.md](./session.md) · [protocol-events.md](./protocol-events.md) → [http-api.md](./http-api.md) · [llm-openai-compatible.md](./llm-openai-compatible.md) · [llm-deepseek.md](./llm-deepseek.md) |
| **Host / CLI** | [host-preset.md](./host-preset.md) · [profiles.md](./profiles.md) · [plugin-loader.md](./plugin-loader.md) · [apps/cli/README](../apps/cli/README.md) |
| **扩展工具 / exec** | [tool-pipeline.md](./tool-pipeline.md) · [seams.md](./seams.md) · [tool-settlement.md](./tool-settlement.md) |
| **上下文 / prompt** | [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · core-system-prompt README |
| **安全** | [security-checklist.md](./security-checklist.md) · [policy.md](./policy.md) |
| **贡献** | [../CONTRIBUTING.md](../CONTRIBUTING.md) · [testing.md](./testing.md) |
| **选型** | [adr/](./adr/README.md) |
| **调研** | [learn/](./learn/README.md)（吸收清单见 three-way-map §6） |

## 规格目录

### Session / Host

| 文档 | 内容 |
|------|------|
| [session.md](./session.md) | Session 文档索引 |
| [protocol-events.md](./protocol-events.md) | 事件 · parse · JSON Schema |
| [session-api.md](./session-api.md) | newSession · admit · continueTurn |
| [session-delivery.md](./session-delivery.md) | steer / queue |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch |
| [session-safety.md](./session-safety.md) | mistake · loop |
| [session-compaction.md](./session-compaction.md) | compaction · overflow |
| [http-api.md](./http-api.md) | HTTP / SSE / env |
| [host-face.md](./host-face.md) | DeepSeek 兼容 Host Face（RPC + 双 WS · 规格） |
| [host-preset.md](./host-preset.md) | Host vs preset 平面 |
| [profiles.md](./profiles.md) | Preset 选型（minimal / harness / server） |
| [plugin-loader.md](./plugin-loader.md) | 插件 discover / load |
| [llm-openai-compatible.md](./llm-openai-compatible.md) | OpenAI 兼容 Chat Completions |
| [llm-deepseek.md](./llm-deepseek.md) | DeepSeek 薄预设（defaults） |
| [llm-provider-registry.md](./llm-provider-registry.md) | Provider Registry（resolve→create · 规格） |
| [llm-provider-presets.md](./llm-provider-presets.md) | BrandEntries 初表（从属 Registry） |

### Plans / Specs

| 计划 | 内容 |
|------|------|
| [superpowers/specs/2026-08-15-compose-design.md](./superpowers/specs/2026-08-15-compose-design.md) | `@xrkseek/compose` 底层设计（Accepted · C0） |
| [superpowers/plans/2026-08-15-compose-c0.md](./superpowers/plans/2026-08-15-compose-c0.md) | Compose C0 实现计划 |
| [superpowers/plans/2026-08-15-llm-provider-registry-r0.md](./superpowers/plans/2026-08-15-llm-provider-registry-r0.md) | Registry R0 实现 |
| [superpowers/plans/2026-08-15-host-face-u1.md](./superpowers/plans/2026-08-15-host-face-u1.md) | Host Face U1 实现 |

### Tools / Exec

| 文档 | 内容 |
|------|------|
| [tool-pipeline.md](./tool-pipeline.md) | 工具瀑布 |
| [tool-settlement.md](./tool-settlement.md) | dangling · parallel settle |
| [tool-output-bound.md](./tool-output-bound.md) | 大结果 bound / persist |
| [seams.md](./seams.md) | Definition / Provider / Consumer |
| [shell-jobs.md](./shell-jobs.md) | shell 后台 job |
| [code-mode.md](./code-mode.md) | `run_code` 实验面 |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` 注入 |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` 展开 |
| [policy.md](./policy.md) | tool/provider/mcp 门禁 |

### Meta

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 包图 · 依赖纪律 · 平面 |
| [status.md](./status.md) | 能力矩阵 · 扩展红线 |
| [testing.md](./testing.md) | `pnpm check` · 测例约定 |
| [security-checklist.md](./security-checklist.md) | 已有控制 · 明确未做 |
| [publishing.md](./publishing.md) | 发包边界（密钥不入库） |
| [migrate-from-agt.md](./migrate-from-agt.md) | 从 AGT 迁概念（非迁源码） |
| [references.md](./references.md) | 外部参考指针 |

## 文档与代码同步规则

1. 改公共契约（事件、HTTP、preset 选项）→ **同 PR** 更新对应 `docs/*`。  
2. 包 README 描述 **本包导出与非目标**；细节链到 `docs/`。  
3. 空壳包（mcp、部分 llm 适配）README 必须写 **Status: empty shell**，禁止假 API。  
4. learn 笔记可滞后；产品规格不得与测试/实现矛盾。
