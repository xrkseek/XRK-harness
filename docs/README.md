# 文档中心

> **读者**：全员

实现以**代码**为准；能否依赖以 [status.md](./status.md) 为准。只写本仓**已有**行为；未做标在 status「未做」。

**先认身份** → [audiences.md](./audiences.md)（四种读者 · 写作标准 · 整篇中英对半 · 阅读路径）。

| 你是谁 | 从这里开始 |
|--------|------------|
| 终端用户（装、跑、用壳） | 根 [README](../README.md) · [getting-started](./getting-started.md) |
| 集成者（HTTP / Face / 工具 / 社区插件） | [status](./status.md) · [community-plugins](./community-plugins.md) · [http-api](./http-api.md) · [host-face](./host-face.md) |
| 贡献者（提 PR） | [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md) |
| 维护者（发版 / 交接） | [maintainer](./maintainer.md) · [publishing](./publishing.md) |

Coding Agent 笔记：[AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`。

## 载体：教科书 · 笔记 · 草稿

| | **教科书** | **笔记** | **本机草稿** |
|--|------------|----------|--------------|
| 位置 | 本目录 · 根/包 README · ADR | [AGENTS.md](../AGENTS.md) · `.cursor/*` | Cursor Canvas |
| 读者 | 用户 · 集成 · 贡献（契约） | 维护者 · Coding Agent | 维护者本人 |
| 写 | 概念、契约、用法、能力边界 | 红线、分层、改哪测哪 | 对照路径、临时 TODO |
| 不写 | 发版口令当用户 FAQ、Agent 禁令 | 假 API 当规格 | 入库 `docs/` |

新文档：中文半部文首 `> **读者**：…`；英文半部 `> **Audience**: …`。正文**整篇先中后英**（见 [audiences](./audiences.md)）。

## 我想…

### 使用产品

| 我想… | 打开 |
|--------|------|
| 先跑起来 | [getting-started](./getting-started.md) · 根 [README](../README.md) |
| 能正式用多少 | [status](./status.md) |
| 装社区 client 包 | [getting-started](./getting-started.md) · [community-plugins](./community-plugins.md) |
| 配 LLM / MCP / 端口 | [configuration](./configuration.md)（优先 Settings UI） |
| 排障 | [troubleshooting](./troubleshooting.md) |
| 短要点 | [learn](./learn.md) |

### 集成 / 扩展

| 我想… | 打开 |
|--------|------|
| 懂架构 | [architecture](./architecture.md) → [compose](./compose.md) → [adr/](./adr/README.md) |
| 接 HTTP / Face | [http-api](./http-api.md) · [host-face](./host-face.md) |
| **接 XRK-AGT（通道平台）** | **[integrators/agt-bridge](./integrators/agt-bridge.md)** |
| 选 preset | [profiles](./profiles.md) · [host-preset](./host-preset.md) |
| 写进程插件 | [plugin-development](./plugin-development.md) · [plugin-loader](./plugin-loader.md) · [community-plugins](./community-plugins.md) |
| 写工具 / 守卫 | [tool-pipeline](./tool-pipeline.md) · [seams](./seams.md) · [policy](./policy.md) |
| Session / 压缩 / meter | [session](./session.md) · [session-compaction](./session-compaction.md) · [modules/session-projection](./modules/session-projection.md)（含 `turnOutline`） · [protocol-events](./protocol-events.md) |
| 看包落点 | [modules/](./modules/README.md) |

### 贡献 / 维护

| 我想… | 打开 |
|--------|------|
| 跑测 / 提 PR | [testing](./testing.md) · [CONTRIBUTING](../CONTRIBUTING.md) |
| 交接本仓 | [maintainer](./maintainer.md) · [audiences](./audiences.md) |
| 发版 | [publishing](./publishing.md)（维护者） |
| 版本说明 | [releases/](./releases/)（正式 [v0.1.24](./releases/v0.1.24.md) · 预览 [v0.0.11](./releases/v0.0.11.md)） |
| 改码笔记 | [AGENTS](../AGENTS.md) · `.cursor/skills` |

## 规格索引

### 体系 / 入门

| 文档 | 读者 | 内容 |
|------|------|------|
| [audiences.md](./audiences.md) | 全员 | 身份 · 写作标准 · 阅读路径 |
| [maintainer.md](./maintainer.md) | 维护者 | 交接清单 · 日常命令 |
| [getting-started.md](./getting-started.md) | 用户 · 贡献 | 安装 · 首跑 · 接模型 |
| [configuration.md](./configuration.md) | 用户 · 集成 | Settings · 环境变量 · 落盘 |
| [troubleshooting.md](./troubleshooting.md) | 用户 · 集成 | 症状表 |
| [status.md](./status.md) | 全员 | 能跑 / 未稳 / 未做 |
| [publishing.md](./publishing.md) | 维护者 | Release · Packages |

### Session / Host

| 文档 | 内容 |
|------|------|
| [session.md](./session.md) | Session 索引 |
| [protocol-events.md](./protocol-events.md) | 事件 · TokenUsage · Schema |
| [session-api.md](./session-api.md) | newSession · admit · continueTurn |
| [session-delivery.md](./session-delivery.md) | steer / queue |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch |
| [session-safety.md](./session-safety.md) | mistake · loop |
| [session-compaction.md](./session-compaction.md) | 换窗压缩 · overflow · meter |
| [modules/session-projection.md](./modules/session-projection.md) | 投影缝 |
| [http-api.md](./http-api.md) | HTTP / SSE |
| [host-face.md](./host-face.md) | Host Face（RPC + 双 WS） |
| [host-preset.md](./host-preset.md) | Host vs preset |
| [profiles.md](./profiles.md) | Preset 选型 |
| [plugin-development.md](./plugin-development.md) | 进程插件 |
| [plugin-loader.md](./plugin-loader.md) | 插件 discover / load |
| [community-plugins.md](./community-plugins.md) | 社区插件 Host 契约 |

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
| [workspace-inject.md](./workspace-inject.md) | 持久注入 |
| [skills-layers.md](./skills-layers.md) | rules / skills 分层 |
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
| [learn.md](./learn.md) | 要义摘录 |
| [modules/](./modules/README.md) | 包文件地图 |
| [adr/](./adr/README.md) | 架构决策 |
| [releases/](./releases/) | 发行说明（正式 [v0.1.24](./releases/v0.1.24.md) · 预览 [v0.0.11](./releases/v0.0.11.md)） |

---

# Documentation Hub

> **Audience**: Everyone

Implementation follows **code**; whether a capability is dependable is governed by [status.md](./status.md). Document only **behavior that exists in this repository**; unfinished work is marked **Not done** in status.

**Identify your audience first** → [audiences.md](./audiences.md) (four roles · writing standards · whole-document CN/EN halves · reading paths).

| Role | Start here |
|------|------------|
| End user (install, run, use the shell) | Root [README](../README.md) · [getting-started](./getting-started.md) |
| Integrator (HTTP / Face / tools / community plugins) | [status](./status.md) · [community-plugins](./community-plugins.md) · [http-api](./http-api.md) · [host-face](./host-face.md) |
| Contributor (PRs) | [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md) |
| Maintainer (release / handoff) | [maintainer](./maintainer.md) · [publishing](./publishing.md) |

Coding Agent notes: [AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`.

## Carriers: textbook · notes · drafts

| | **Textbook** | **Notes** | **Local draft** |
|--|--------------|-----------|-----------------|
| Location | This directory · root/package READMEs · ADRs | [AGENTS.md](../AGENTS.md) · `.cursor/*` | Cursor Canvas |
| Audience | Users · integrators · contributors (contracts) | Maintainers · Coding Agent | The maintainer alone |
| Write | Concepts, contracts, usage, capability boundaries | Red lines, layering, where to change/test | Local paths, temporary TODOs |
| Do not | Release commands as user FAQ, Agent prohibitions | Fake APIs as specs | Commit into `docs/` |

New documents: Chinese half starts with `> **读者**：…`; English half with `> **Audience**: …`. Body text is **whole-document Chinese then English** ([audiences](./audiences.md)).

## I want to…

### Use the product

| Goal | Open |
|------|------|
| Get running | [getting-started](./getting-started.md) · root [README](../README.md) |
| What is dependable | [status](./status.md) |
| Install community clients | [getting-started](./getting-started.md) · [community-plugins](./community-plugins.md) |
| Configure LLM / MCP / ports | [configuration](./configuration.md) (Settings UI first) |
| Troubleshoot | [troubleshooting](./troubleshooting.md) |
| Short digest | [learn](./learn.md) |

### Integrate / extend

| Goal | Open |
|------|------|
| Embed from XRK-AGT | [integrators/agt-bridge](./integrators/agt-bridge.md) |
| Architecture | [architecture](./architecture.md) → [compose](./compose.md) → [adr/](./adr/README.md) |
| HTTP / Face | [http-api](./http-api.md) · [host-face](./host-face.md) |
| Choose preset | [profiles](./profiles.md) · [host-preset](./host-preset.md) |
| Process plugins | [plugin-development](./plugin-development.md) · [plugin-loader](./plugin-loader.md) · [community-plugins](./community-plugins.md) |
| Tools / guards | [tool-pipeline](./tool-pipeline.md) · [seams](./seams.md) · [policy](./policy.md) |
| Session / compaction / meter | [session](./session.md) · [session-compaction](./session-compaction.md) · [modules/session-projection](./modules/session-projection.md) (incl. `turnOutline`) · [protocol-events](./protocol-events.md) |
| Package map | [modules/](./modules/README.md) |

### Contribute / maintain

| Goal | Open |
|------|------|
| Test / PR | [testing](./testing.md) · [CONTRIBUTING](../CONTRIBUTING.md) |
| Handoff | [maintainer](./maintainer.md) · [audiences](./audiences.md) |
| Release | [publishing](./publishing.md) (maintainers) |
| Release notes | [releases/](./releases/) (formal [v0.1.24](./releases/v0.1.24.md) · preview [v0.0.11](./releases/v0.0.11.md)) |
| Coding notes | [AGENTS](../AGENTS.md) · `.cursor/skills` |

## Spec index

### System / getting started

| Doc | Audience | Content |
|-----|----------|---------|
| [audiences.md](./audiences.md) | Everyone | Roles · writing standards · reading paths |
| [maintainer.md](./maintainer.md) | Maintainer | Handoff · day-to-day commands |
| [getting-started.md](./getting-started.md) | User · Contributor | Install · first run · connect a model |
| [configuration.md](./configuration.md) | User · Integrator | Settings · env · on-disk paths |
| [troubleshooting.md](./troubleshooting.md) | User · Integrator | Symptom table |
| [status.md](./status.md) | Everyone | Working / Unstable / Not done |
| [publishing.md](./publishing.md) | Maintainer | Release · Packages |

### Session / Host

| Doc | Content |
|-----|---------|
| [session.md](./session.md) | Session index |
| [protocol-events.md](./protocol-events.md) | Events · TokenUsage · Schema |
| [session-api.md](./session-api.md) | newSession · admit · continueTurn |
| [session-delivery.md](./session-delivery.md) | steer / queue |
| [session-latch.md](./session-latch.md) | TurnLatch · DrainLatch |
| [session-safety.md](./session-safety.md) | mistake · loop |
| [session-compaction.md](./session-compaction.md) | Windowing · overflow · meter |
| [modules/session-projection.md](./modules/session-projection.md) | Projection seam |
| [http-api.md](./http-api.md) | HTTP / SSE |
| [host-face.md](./host-face.md) | Host Face (RPC + dual WS) |
| [host-preset.md](./host-preset.md) | Host vs preset |
| [profiles.md](./profiles.md) | Preset selection |
| [plugin-development.md](./plugin-development.md) | Process plugins |
| [plugin-loader.md](./plugin-loader.md) | Discover / load |
| [community-plugins.md](./community-plugins.md) | Community Host contracts |

### LLM

| Doc | Content |
|-----|---------|
| [llm-openai-compatible.md](./llm-openai-compatible.md) | OpenAI-compatible Chat Completions |
| [llm-deepseek.md](./llm-deepseek.md) | DeepSeek API presets |
| [llm-provider-registry.md](./llm-provider-registry.md) | Provider Registry |
| [llm-provider-presets.md](./llm-provider-presets.md) | BrandEntries |

### Tools / Workspace

| Doc | Content |
|-----|---------|
| [tool-pipeline.md](./tool-pipeline.md) | Tool waterfall |
| [tool-settlement.md](./tool-settlement.md) | dangling · parallel settle |
| [tool-output-bound.md](./tool-output-bound.md) | Large-result bound |
| [seams.md](./seams.md) | Definition / Provider / Consumer |
| [web-tools.md](./web-tools.md) | `web_search` / `web_fetch` |
| [lsp-tools.md](./lsp-tools.md) | `lsp` four operations |
| [pty-tools.md](./pty-tools.md) | `terminal_*` |
| [shell-jobs.md](./shell-jobs.md) | Background shell jobs |
| [code-mode.md](./code-mode.md) | `run_code` experimental surface |
| [workspace-inject.md](./workspace-inject.md) | Persistent inject |
| [skills-layers.md](./skills-layers.md) | Rules / skills layering |
| [slash-recipes.md](./slash-recipes.md) | `/recipe-id` · `/skill-name` |
| [policy.md](./policy.md) | tool / provider / mcp gates |
| [modules/mcp.md](./modules/mcp.md) | MCP client map |
| [compose.md](./compose.md) | `@xrkseek/compose` |

### Meta

| Doc | Content |
|-----|---------|
| [architecture.md](./architecture.md) | Package map · deps · doc layering |
| [testing.md](./testing.md) | `pnpm check` |
| [security-checklist.md](./security-checklist.md) | Security controls |
| [learn.md](./learn.md) | Short digest |
| [modules/](./modules/README.md) | Package file map |
| [adr/](./adr/README.md) | Architecture decisions |
| [releases/](./releases/) | Release notes (formal [v0.1.24](./releases/v0.1.24.md) · preview [v0.0.11](./releases/v0.0.11.md)) |
