# 文档中心

仓库根 [README.md](../README.md) 是产品入口。**本目录是教科书**：系统说明本仓已实现的行为与契约。

实现以**代码**为准；能否依赖以 [status.md](./status.md) 为准。只写**已有**能力；未做标在 status「未做」，不写成假 API。

## 教科书 · 笔记 · 草稿

| | **教科书** | **笔记** | **本机草稿** |
|--|------------|----------|--------------|
| 位置 | 本目录 · 根/包 README · ADR | [AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills` | Cursor Canvas |
| 读者 | 用户、集成者、学习者 | 改代码的人 / Coding Agent | 维护者本人 |
| 写 | 概念、契约、用法、能力边界 | 红线、分层、改哪测哪 | 对照路径、临时 TODO |
| 不写 | 改码禁令、「本刀」、Agent 操作步骤 | 当产品规格的假 API | 入库 `docs/` |

Session 压缩 / Context meter：先读教科书 [session-compaction.md](./session-compaction.md)；改码再开笔记 skill `xrk-meter-session`。

## 章节属性

| 章类 | 位置 | 写 | 不写 |
|------|------|----|------|
| **产品入口** | 根 `README.md` | 是什么、怎么跑、用户 FAQ | 发版步骤、Agent 红线、本机路径 |
| **能力诚实** | [status.md](./status.md) | 能跑 / 未稳 / 未做 | 路线图幻想 |
| **入门** | [getting-started.md](./getting-started.md) | 安装 · 开发/生产 · 接模型 | 全量契约 |
| **配置** | [configuration.md](./configuration.md) | 环境变量 · 落盘路径 | 密钥真值 |
| **排障** | [troubleshooting.md](./troubleshooting.md) | 症状 → 处理 | 未证实 workaround |
| **契约** | 本目录专题 | HTTP · Face · session · 工具 · LLM | 「计划支持」当规格 |
| **要义摘录** | [learn.md](./learn.md) | 已落地短要点 | 未实现路线、改码红线 |
| **包地图** | [modules/](./modules/README.md) | 文件职责与测例锚点 | 「如何读文档」元规则 |
| **决策** | [adr/](./adr/README.md) | 已采纳 ADR | 未立项 ADR |
| **贡献门禁** | [../CONTRIBUTING.md](../CONTRIBUTING.md) · [testing.md](./testing.md) | check · 契约同步 | 个人机器绝对路径 |

## 我想…

| 我想… | 从这里开始 |
|--------|------------|
| 先跑起来 | [getting-started.md](./getting-started.md) · 根 [README](../README.md) |
| 知道能正式用多少 | [status.md](./status.md) |
| 配 LLM / MCP / 端口 | [configuration.md](./configuration.md) |
| 排障 | [troubleshooting.md](./troubleshooting.md) |
| 懂架构 | [architecture.md](./architecture.md) → [compose.md](./compose.md) → ADR |
| 接 HTTP / Face | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| 选 preset | [profiles.md](./profiles.md) · [host-preset.md](./host-preset.md) |
| 写工具 / 守卫 | [tool-pipeline.md](./tool-pipeline.md) · [seams.md](./seams.md) · [policy.md](./policy.md) |
| Session 压缩与 Context meter | [session-compaction.md](./session-compaction.md) · [protocol-events.md](./protocol-events.md) |
| 看包落点 | [modules/](./modules/README.md) |
| 跑测 / 发 PR | [testing.md](./testing.md) · [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| 发包边界 | [publishing.md](./publishing.md) |
| 已落地要点（短） | [learn.md](./learn.md) |
| **维护本仓 / 发版** | [../CONTRIBUTING.md](../CONTRIBUTING.md) · [publishing.md](./publishing.md) · [../AGENTS.md](../AGENTS.md) |

## 按角色

| 角色 | 顺序 |
|------|------|
| 试用 / 集成 | 根 [README](../README.md) → status → getting-started → configuration → http-api · host-face |
| 能力叶 / 工具作者 | 教科书 tool-pipeline · seams · policy · modules/；改码时再读 [AGENTS.md](../AGENTS.md) |
| Host / Face | host-preset · profiles · plugin-loader · modules/server-host · host-face |
| 产品壳 | host-face · `apps/web` · `packages/client` · getting-started（先编 dist 再 serve） |
| 安全 | security-checklist · policy |
| 维护者（读教科书） | architecture · learn · modules · adr · publishing |
| 维护者 / Agent（改码） | [AGENTS.md](../AGENTS.md) · `.cursor/rules` · 对应 skill |

## 规格索引

### 入门 / 运维

| 文档 | 内容 |
|------|------|
| [getting-started.md](./getting-started.md) | 安装 · 首跑 · 产品壳 · MCP |
| [configuration.md](./configuration.md) | 环境变量 · 落盘路径 |
| [troubleshooting.md](./troubleshooting.md) | 症状表 |
| [status.md](./status.md) | 能力矩阵 · 正式使用分层 |
| [publishing.md](./publishing.md) | GitHub Release · Packages |

### Session / Host

| 文档 | 内容 |
|------|------|
| [session.md](./session.md) | Session 索引 |
| [protocol-events.md](./protocol-events.md) | 事件 · TokenUsage · Schema |
| [session-api.md](./session-api.md) | newSession · admit · continueTurn |
| [session-delivery.md](./session-delivery.md) | steer / queue |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch |
| [session-safety.md](./session-safety.md) | mistake · loop |
| [session-compaction.md](./session-compaction.md) | 换窗压缩 · overflow · Token 估算 · Context meter |
| [http-api.md](./http-api.md) | HTTP / SSE |
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
| [web-tools.md](./web-tools.md) | `web_search` / `web_fetch` |
| [lsp-tools.md](./lsp-tools.md) | `lsp` 四操作 |
| [pty-tools.md](./pty-tools.md) | `terminal_*` |
| [shell-jobs.md](./shell-jobs.md) | shell 后台 job |
| [code-mode.md](./code-mode.md) | `run_code` 实验面 |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` 注入 |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` · `/skill-name` |
| [policy.md](./policy.md) | tool / provider / mcp 门禁 |
| [modules/mcp.md](./modules/mcp.md) | MCP client 地图 |
| [compose.md](./compose.md) | `@xrkseek/compose` |

### Meta

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 包图 · 依赖 · 文档分层 |
| [testing.md](./testing.md) | `pnpm check` |
| [security-checklist.md](./security-checklist.md) | 安全控制 |
| [learn.md](./learn.md) | 要义摘录（短；非改码笔记） |
| [publishing.md](./publishing.md) | Release · GitHub Packages |
| [modules/](./modules/README.md) | 包文件地图 |
| [adr/](./adr/README.md) | 架构决策 |
| [releases/](./releases/) | 发行说明（当前 [v0.1.5](./releases/v0.1.5.md)） |
