# 文档中心 / Documentation Hub

> **读者 / Audience**：全员 / Everyone

实现以**代码**为准；能否依赖以 [status.md](./status.md) 为准。只写**本仓已有**行为；未做标在 status「未做 / Not done」。

Implementation follows **code**; whether a capability is dependable is governed by [status.md](./status.md). Document only **behavior that exists in this repository**; unfinished work is marked **Not done** in status.

**先认身份再往下读** → [audiences.md](./audiences.md)（四种读者 · 写作标准 · 中英双语体例 · 阅读路径）。

Identify your audience first → [audiences.md](./audiences.md) (four roles · writing standards · bilingual form · reading paths).

| 你是谁 / Role | 从这里开始 / Start here |
|--------|------------|
| 终端用户（装、跑、用壳） / End user | 根 [README](../README.md) · [getting-started](./getting-started.md) |
| 集成者（HTTP / Face / 工具 / 社区插件） / Integrator | [status](./status.md) · [community-plugins](./community-plugins.md) · [http-api](./http-api.md) · [host-face](./host-face.md) |
| 贡献者（提 PR） / Contributor | [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md) |
| 维护者（发版 / 交接） / Maintainer | [maintainer](./maintainer.md) · [publishing](./publishing.md) |

Coding Agent 笔记 / Coding Agent notes：[AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`。

---

## 载体：教科书 · 笔记 · 草稿 / Carriers: Textbook · Notes · Drafts

| | **教科书 / Textbook** | **笔记 / Notes** | **本机草稿 / Local draft** |
|--|------------|----------|--------------|
| 位置 / Location | 本目录 · 根/包 README · ADR | [AGENTS.md](../AGENTS.md) · `.cursor/*` | Cursor Canvas |
| 读者 / Audience | 用户 · 集成 · 贡献（契约） | 维护者 · Coding Agent | 维护者本人 |
| 写 / Write | 概念、契约、用法、能力边界 | 红线、分层、改哪测哪 | 对照路径、临时 TODO |
| 不写 / Do not | 发版口令当用户 FAQ、Agent 禁令 | 假 API 当规格 | 入库 `docs/` |

新文档文首：`> **读者 / Audience**：… / …`（标准见 [audiences](./audiences.md)）。正文采用正式**中英双语**。

New documents start with a bilingual audience line. Body text uses formal **Chinese–English** pairing.

---

## 我想… / I want to…

### 使用产品 / Use the product

| 我想… / Goal | 打开 / Open |
|--------|------|
| 先跑起来 / Get running | [getting-started](./getting-started.md) · 根 [README](../README.md) |
| 能正式用多少 / What is dependable | [status](./status.md) |
| 装社区 client 包 / Install community clients | [getting-started](./getting-started.md) · [community-plugins](./community-plugins.md) |
| 配 LLM / MCP / 端口 / Configure | [configuration](./configuration.md) |
| 排障 / Troubleshoot | [troubleshooting](./troubleshooting.md) |
| 短要点 / Short digest | [learn](./learn.md) |

### 集成 / 扩展 / Integrate / Extend

| 我想… / Goal | 打开 / Open |
|--------|------|
| 懂架构 / Architecture | [architecture](./architecture.md) → [compose](./compose.md) → [adr/](./adr/README.md) |
| 接 HTTP / Face | [http-api](./http-api.md) · [host-face](./host-face.md) |
| 选 preset / Choose preset | [profiles](./profiles.md) · [host-preset](./host-preset.md) |
| 写进程插件 / Process plugins | [plugin-development](./plugin-development.md) · [plugin-loader](./plugin-loader.md) · [community-plugins](./community-plugins.md) |
| 写工具 / 守卫 / Tools / guards | [tool-pipeline](./tool-pipeline.md) · [seams](./seams.md) · [policy](./policy.md) |
| Session / 压缩 / meter | [session](./session.md) · [session-compaction](./session-compaction.md) · [modules/session-projection](./modules/session-projection.md) · [protocol-events](./protocol-events.md) |
| 看包落点 / Package map | [modules/](./modules/README.md) |

### 贡献 / 维护 / Contribute / Maintain

| 我想… / Goal | 打开 / Open |
|--------|------|
| 跑测 / 提 PR / Test / PR | [testing](./testing.md) · [CONTRIBUTING](../CONTRIBUTING.md) |
| 交接本仓 / Handoff | [maintainer](./maintainer.md) · [audiences](./audiences.md) |
| 发版 / Release | [publishing](./publishing.md)（**维护者 / Maintainers**） |
| 版本说明 / Release notes | [releases/](./releases/)（正式 / formal [v0.1.0](./releases/v0.1.0.md) · 预览 / preview [v0.0.11](./releases/v0.0.11.md)） |
| 改码笔记 / Coding notes | [AGENTS](../AGENTS.md) · `.cursor/skills` |

---

## 规格索引 / Spec index

### 体系 / 入门 / System / Getting started

| 文档 / Doc | 读者 / Audience | 内容 / Content |
|------|------|------|
| [audiences.md](./audiences.md) | 全员 / Everyone | 身份 · 写作标准 · 阅读路径 |
| [maintainer.md](./maintainer.md) | 维护者 / Maintainer | 交接清单 · 日常命令 |
| [getting-started.md](./getting-started.md) | 用户 · 贡献 / User · Contributor | 安装 · 首跑 · 接模型 |
| [configuration.md](./configuration.md) | 用户 · 集成 / User · Integrator | 环境变量 · 落盘 |
| [troubleshooting.md](./troubleshooting.md) | 用户 · 集成 / User · Integrator | 症状表 |
| [status.md](./status.md) | 全员 / Everyone | 能跑 / 未稳 / 未做 |
| [publishing.md](./publishing.md) | 维护者 / Maintainer | Release · Packages |

### Session / Host

| 文档 / Doc | 内容 / Content |
|------|------|
| [session.md](./session.md) | Session 索引 / Session index |
| [protocol-events.md](./protocol-events.md) | 事件 · TokenUsage · Schema |
| [session-api.md](./session-api.md) | newSession · admit · continueTurn |
| [session-delivery.md](./session-delivery.md) | steer / queue |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch |
| [session-safety.md](./session-safety.md) | mistake · loop |
| [session-compaction.md](./session-compaction.md) | 换窗压缩 · overflow · meter |
| [modules/session-projection.md](./modules/session-projection.md) | 投影缝 / Projection seam |
| [http-api.md](./http-api.md) | HTTP / SSE |
| [host-face.md](./host-face.md) | Host Face（RPC + 双 WS） |
| [host-preset.md](./host-preset.md) | Host vs preset |
| [profiles.md](./profiles.md) | Preset 选型 / Preset selection |
| [plugin-development.md](./plugin-development.md) | 进程插件 / Process plugins |
| [plugin-loader.md](./plugin-loader.md) | 插件 discover / load |
| [community-plugins.md](./community-plugins.md) | 社区插件 Host 契约（中英） / Community Host contracts (bilingual) |

### LLM

| 文档 / Doc | 内容 / Content |
|------|------|
| [llm-openai-compatible.md](./llm-openai-compatible.md) | OpenAI 兼容 Chat Completions |
| [llm-deepseek.md](./llm-deepseek.md) | DeepSeek API 预设 / presets |
| [llm-provider-registry.md](./llm-provider-registry.md) | Provider Registry |
| [llm-provider-presets.md](./llm-provider-presets.md) | BrandEntries |

### Tools / Workspace

| 文档 / Doc | 内容 / Content |
|------|------|
| [tool-pipeline.md](./tool-pipeline.md) | 工具瀑布 / Tool waterfall |
| [tool-settlement.md](./tool-settlement.md) | dangling · parallel settle |
| [tool-output-bound.md](./tool-output-bound.md) | 大结果 bound / Large-result bound |
| [seams.md](./seams.md) | Definition / Provider / Consumer |
| [web-tools.md](./web-tools.md) | `web_search` / `web_fetch` |
| [lsp-tools.md](./lsp-tools.md) | `lsp` 四操作 / four operations |
| [pty-tools.md](./pty-tools.md) | `terminal_*` |
| [shell-jobs.md](./shell-jobs.md) | shell 后台 job |
| [code-mode.md](./code-mode.md) | `run_code` 实验面 / experimental |
| [workspace-inject.md](./workspace-inject.md) | `.xrk` 持久注入 / Persistent inject |
| [skills-layers.md](./skills-layers.md) | 笔记 / 产品 rules / skills 分层 |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` · `/skill-name` |
| [policy.md](./policy.md) | tool / provider / mcp 门禁 |
| [modules/mcp.md](./modules/mcp.md) | MCP client 地图 / map |
| [compose.md](./compose.md) | `@xrkseek/compose` |

### Meta

| 文档 / Doc | 内容 / Content |
|------|------|
| [architecture.md](./architecture.md) | 包图 · 依赖 · 文档分层 |
| [testing.md](./testing.md) | `pnpm check` |
| [security-checklist.md](./security-checklist.md) | 安全控制 / Security controls |
| [learn.md](./learn.md) | 要义摘录 / Short digest |
| [modules/](./modules/README.md) | 包文件地图 / Package file map |
| [adr/](./adr/README.md) | 架构决策 / Architecture decisions |
| [releases/](./releases/) | 发行说明 / Release notes（正式 [v0.1.0](./releases/v0.1.0.md) · 预览 [v0.0.11](./releases/v0.0.11.md)） |
