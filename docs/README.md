# 文档中心

实现以**代码**为准；能否依赖以 [status.md](./status.md) 为准。只写**本仓已有**行为；未做标在 status「未做」。

**先认身份再往下读** → [audiences.md](./audiences.md)（四种读者 · 写作标准 · 阅读路径）。

| 你是谁 | 从这里开始 |
|--------|------------|
| 终端用户（装、跑、用壳） | 根 [README](../README.md) · [getting-started](./getting-started.md) |
| 集成者（HTTP / Face / 工具） | [status](./status.md) · [http-api](./http-api.md) · [host-face](./host-face.md) |
| 贡献者（提 PR） | [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md) |
| 维护者（发版 / 交接） | [maintainer](./maintainer.md) · [publishing](./publishing.md) |

Coding Agent 笔记：[AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`。

---

## 载体：教科书 · 笔记 · 草稿

| | **教科书** | **笔记** | **本机草稿** |
|--|------------|----------|--------------|
| 位置 | 本目录 · 根/包 README · ADR | [AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills` | Cursor Canvas |
| 读者 | 用户 · 集成 · 贡献（契约部分） | 维护者 · Coding Agent | 维护者本人 |
| 写 | 概念、契约、用法、能力边界 | 红线、分层、改哪测哪 | 对照路径、临时 TODO |
| 不写 | 发版口令当用户 FAQ、Agent 禁令 | 假 API 当规格 | 入库 `docs/` |

新文档文首加：`> **读者**：…`（标准见 [audiences](./audiences.md)）。

---

## 我想…

### 使用产品

| 我想… | 打开 |
|--------|------|
| 先跑起来 | [getting-started](./getting-started.md) · 根 [README](../README.md) |
| 能正式用多少 | [status](./status.md) |
| 配 LLM / MCP / 端口 | [configuration](./configuration.md) |
| 排障 | [troubleshooting](./troubleshooting.md) |
| 短要点 | [learn](./learn.md) |

### 集成 / 扩展

| 我想… | 打开 |
|--------|------|
| 懂架构 | [architecture](./architecture.md) → [compose](./compose.md) → [adr/](./adr/README.md) |
| 接 HTTP / Face | [http-api](./http-api.md) · [host-face](./host-face.md) |
| 选 preset | [profiles](./profiles.md) · [host-preset](./host-preset.md) |
| 写工具 / 守卫 | [tool-pipeline](./tool-pipeline.md) · [seams](./seams.md) · [policy](./policy.md) |
| Session / 压缩 / meter | [session](./session.md) · [session-compaction](./session-compaction.md) · [modules/session-projection](./modules/session-projection.md) · [protocol-events](./protocol-events.md) |
| 看包落点 | [modules/](./modules/README.md) |

### 贡献 / 维护

| 我想… | 打开 |
|--------|------|
| 跑测 / 提 PR | [testing](./testing.md) · [CONTRIBUTING](../CONTRIBUTING.md) |
| 交接本仓 | [maintainer](./maintainer.md) · [audiences](./audiences.md) |
| 发版 | [publishing](./publishing.md)（**维护者**） |
| 版本说明 | [releases/](./releases/)（当前 [v0.0.7](./releases/v0.0.7.md)） |
| 改码笔记 | [AGENTS](../AGENTS.md) · `.cursor/skills` |

---

## 规格索引

### 体系 / 入门

| 文档 | 读者 | 内容 |
|------|------|------|
| [audiences.md](./audiences.md) | 全员 | 身份 · 写作标准 · 阅读路径 |
| [maintainer.md](./maintainer.md) | 维护者 | 交接清单 · 日常命令 |
| [getting-started.md](./getting-started.md) | 用户 · 贡献 | 安装 · 首跑 · 接模型 |
| [configuration.md](./configuration.md) | 用户 · 集成 | 环境变量 · 落盘 |
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
| [modules/session-projection.md](./modules/session-projection.md) | 投影缝：状态/视图 · wire-only snapshot |
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
| [workspace-inject.md](./workspace-inject.md) | `.xrk` 持久注入（agent-instructions） |
| [skills-layers.md](./skills-layers.md) | 笔记 / 产品 rules / 产品 skills 分层 |
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
| [learn.md](./learn.md) | 要义摘录（短） |
| [modules/](./modules/README.md) | 包文件地图 |
| [adr/](./adr/README.md) | 架构决策 |
| [releases/](./releases/) | 发行说明（当前 [v0.0.7](./releases/v0.0.7.md)） |
