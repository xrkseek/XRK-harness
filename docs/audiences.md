# 读者身份（文档体系标准） / Documentation Audiences

> **读者 / Audience**：维护者 · 贡献者（定文档体例、分流教科书与笔记） / Maintainers · Contributors (documentation standards)

写文档或交接前先认清**给谁看**。身份混用是文档难用的主因。

Before writing or handing off, identify **who** the document is for. Mixing audiences is the main reason docs become unusable.

## 四种身份 / Four Audiences

| 身份 / Role | 要做什么 / Goal | 从哪进 / Entry | 不该塞给他 / Do not include |
|------|----------|--------|------------|
| **终端用户 / End user** | 装 CLI / 开网页、接模型、日常用壳 | 根 [README](../README.md) → [getting-started](./getting-started.md) | 发版命令、包依赖图、Agent 红线 |
| **集成者 / Integrator** | 接 HTTP / Face / SDK、写工具、配 MCP / policy、装社区插件 | [status](./status.md) → [community-plugins](./community-plugins.md) · [http-api](./http-api.md) · [host-face](./host-face.md) | 本机 Canvas、`.cursor` 笔记 |
| **贡献者 / Contributor** | 提 PR、改一包、补测 | [CONTRIBUTING](../CONTRIBUTING.md) → [testing](./testing.md) · [modules](./modules/README.md) | 把未做写成规格；密钥 |
| **维护者 / Maintainer** | 发版、定架构、交接、管 Agent | [maintainer](./maintainer.md) · [publishing](./publishing.md) · [AGENTS](../AGENTS.md) | 写进根 README 当用户 FAQ |

Coding Agent **不是**第五种产品读者：它读 [AGENTS.md](../AGENTS.md) 与 `.cursor/rules` · `.cursor/skills`（**笔记**）。产品说明书在 `docs/`（**教科书**）。运行时产品 Agent 的 skills / rules 分层见 [skills-layers.md](./skills-layers.md)。

A Coding Agent is **not** a fifth product audience: it reads [AGENTS.md](../AGENTS.md) and `.cursor/*` (**notes**). Product manuals live under `docs/` (**textbook**). Runtime product Agent skills/rules layering: [skills-layers.md](./skills-layers.md).

## 载体分层 / Document Carriers

| 载体 / Carrier | 身份 / Audience | 例子 / Examples |
|------|----------|--------|
| 根 README | 终端用户为主 | 是什么、怎么跑、用户 FAQ |
| `docs/*` 专题 | 用户 · 集成 ·（部分）贡献 | 契约、配置、排障 |
| `docs/modules/` | 贡献 · 维护 | 文件落点 |
| `docs/maintainer.md` · `publishing.md` | **仅维护者** | 交接、发版 |
| `CONTRIBUTING.md` | 贡献 · 维护 | check、契约同步 |
| `AGENTS.md` · `.cursor/*` | 维护 · Coding Agent | 红线、改哪测哪 |
| Cursor Canvas | 维护者本人 | 本机路径；**不入库** |

## 写作标准 / Writing Standards

新文档或大改时必须遵守：

When creating or substantially revising a document:

1. **文首读者 / Audience line**：`> **读者 / Audience**：终端用户 · 集成者 / End users · Integrators`（可多选，须诚实）。
2. **中英双语 / Bilingual**：正文采用正式中英对照——标题 `中文 / English`；关键段落先中文、后英文；表格列可用 `中文 / English` 表头。代码注释：**纯英文**，或「中文。 / English.」双语，禁止仅中文注释。
3. **只写该身份需要的命令与概念**；发版、Agent 禁令、本机绝对路径不进用户文。 / Include only commands and concepts for that audience; release steps, Agent prohibitions, and absolute local paths stay out of end-user docs.
4. **能力边界**指向 [status.md](./status.md)；未做只标「未做 / Not done」，不写假 API。 / Capability truth is [status.md](./status.md); unfinished work is marked **Not done**, never as a fake API.
5. **改契约**必须改对应教科书 + status；改码红线只改笔记。 / Contract changes update the textbook + status; coding red lines update notes only.
6. 标题与导航用**用户语言**；少用内部黑话。 / Prefer user-facing wording in titles and navigation; avoid internal jargon.
7. **Host / 社区插件**文档写 **XRK 自研能力与待补特性**，不以「未抄上游清单」表述。 / Host and community-plugin docs describe **XRK first-party capabilities and planned work**, not an “unported upstream checklist.”

## 按身份阅读路径 / Reading Paths

### 终端用户 / End user

1. [根 README](../README.md)  
2. [getting-started](./getting-started.md) · [configuration](./configuration.md)  
3. 卡住 → [troubleshooting](./troubleshooting.md)  
4. 想确认稳不稳 → [status](./status.md)

### 集成者 / Integrator（HTTP / Face / 工具）

1. [status](./status.md) · [architecture](./architecture.md)  
2. [http-api](./http-api.md) · [host-face](./host-face.md)  
3. Session：[session](./session.md) · [protocol-events](./protocol-events.md) · [session-compaction](./session-compaction.md)  
4. 工具：[tool-pipeline](./tool-pipeline.md) · [seams](./seams.md) · [policy](./policy.md)  
5. 社区插件：[community-plugins](./community-plugins.md) · [plugin-loader](./plugin-loader.md)  
6. 要义：[learn](./learn.md)

### 贡献者 / Contributor

1. [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md)  
2. [modules](./modules/README.md) · 相关契约专题  
3. 角色边界：[AGENTS](../AGENTS.md) 角色表（勿把红线抄进 PR 说明书）

### 维护者 / Maintainer

1. **必读**：[maintainer](./maintainer.md)  
2. [publishing](./publishing.md) · [architecture](./architecture.md) · [adr/](./adr/README.md)  
3. [status](./status.md) · [learn](./learn.md) · [releases/](./releases/)  
4. 笔记：[AGENTS](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`

## 索引 / Index

全索引 / Full index：[README.md](./README.md)。
