# 文档中心

仓库根 [README.md](../README.md) 负责产品介绍与最短安装路径。**本页**是规格与开发文档索引。

实现以代码 + [status.md](./status.md) 为准。文档只描述**本仓已有**行为；未实现能力标在 status「未做」，不写成假 API。

## 文档属性（写什么 / 不写什么）

| 属性 | 位置 | 读者 | 写 | 不写 |
|------|------|------|----|------|
| **产品入口** | 根 `README.md` | 所有人 | 是什么、状态摘要、最短跑通、文档索引 | Agent 红线、本机路径、对照仓笔记 |
| **能力诚实** | [status.md](./status.md) | 集成 / 评估 | 能跑 / 未稳 / 未做 · 正式使用分层 | 路线图幻想、对照仓体量 |
| **入门** | [getting-started.md](./getting-started.md) | 新贡献者 | 安装 · 首命令 · 壳组装 · MCP 开关 | 全量契约细节 |
| **配置** | [configuration.md](./configuration.md) | 运维 / 集成 | 环境变量 · 落盘路径 | 密钥真值 |
| **排障** | [troubleshooting.md](./troubleshooting.md) | 使用者 | 症状 → 处理 | 未证实 workaround |
| **契约规格** | 本目录专题 `.md` | 集成 / 维护 | 已实现 HTTP · Face · session · 工具 · LLM | 「计划支持」清单当规格 |
| **包地图** | [modules/](./modules/README.md) | 维护者 | 文件职责与测试锚点 | 教人怎么读文档的元规则 |
| **决策** | [adr/](./adr/README.md) | 维护者 | 已采纳 ADR | 未立项 ADR |
| **贡献门禁** | [../CONTRIBUTING.md](../CONTRIBUTING.md) · [testing.md](./testing.md) | 贡献者 | check 步骤 · 改契约同步表 | 个人机器绝对路径 |
| **Agent 约定** | [../AGENTS.md](../AGENTS.md) | Cursor / 自动化 / 维护者 | 角色边界 · 按域放码 · 红线 · 完成定义 | 面向终端用户的安装教程（那是根 README） |
| **本机对照** | Cursor Canvas（不入库） | 维护者本人 | 对照仓路径 · 体量 · 打磨 TODO | 进 `docs/` / README |

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
| 看包落点 | [modules/](./modules/README.md) |
| 跑测 / 发 PR | [testing.md](./testing.md) · [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| 发包边界 | [publishing.md](./publishing.md) |
| 已落地要点（短） | [learn.md](./learn.md) |

## 按角色

| 角色 | 顺序 |
|------|------|
| 试用 / 集成 | 根 [README](../README.md)「如果你是第一次接触」→ status → getting-started → configuration → http-api · host-face |
| 能力叶 / 工具作者 | [AGENTS.md](../AGENTS.md) 角色表 → tool-pipeline · seams · policy · modules/ |
| Host / Face | host-preset · profiles · plugin-loader · modules/server-host · host-face |
| 产品壳 | host-face · `apps/web` · `packages/client` · getting-started（先编 dist 再 serve） |
| 安全 | security-checklist · policy |
| 维护者 / Agent | [AGENTS.md](../AGENTS.md) · architecture · learn · modules · adr · publishing |

## 规格索引

### 入门 / 运维

| 文档 | 内容 |
|------|------|
| [getting-started.md](./getting-started.md) | 安装 · 首跑 · 产品壳 · MCP |
| [configuration.md](./configuration.md) | 环境变量 · 落盘路径 |
| [troubleshooting.md](./troubleshooting.md) | 症状表 |
| [status.md](./status.md) | 能力矩阵 · 正式使用分层 |
| [publishing.md](./publishing.md) | npm Phase 0/1 |

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
| [learn.md](./learn.md) | 已落地要点（短） |
| [modules/](./modules/README.md) | 包文件地图 |
| [adr/](./adr/README.md) | 架构决策 |
