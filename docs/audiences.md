# 读者身份

> **读者**：维护者 · 贡献者（定文档体例、分流教科书与笔记）

写文档或交接前先认清**给谁看**。身份混用是文档难用的主因。

## 四种身份

| 身份 | 要做什么 | 从哪进 | 不该塞给他 |
|------|----------|--------|------------|
| **终端用户** | 装 CLI / 开网页、接模型、日常用壳 | 根 [README](../README.md) → [getting-started](./getting-started.md) | 发版命令、包依赖图、Agent 红线 |
| **集成者** | 接 HTTP / Face / SDK、写工具、配 MCP / policy、装社区插件 | [status](./status.md) → [community-plugins](./community-plugins.md) · [http-api](./http-api.md) · [host-face](./host-face.md) | 本机 Canvas、`.cursor` 笔记 |
| **贡献者** | 提 PR、改一包、补测 | [CONTRIBUTING](../CONTRIBUTING.md) → [testing](./testing.md) · [modules](./modules/README.md) | 把未做写成规格；密钥 |
| **维护者** | 发版、定架构、交接、管 Agent | [maintainer](./maintainer.md) · [publishing](./publishing.md) · [AGENTS](../AGENTS.md) | 写进根 README 当用户 FAQ |

Coding Agent **不是**第五种产品读者：它读 [AGENTS.md](../AGENTS.md) 与 `.cursor/rules` · `.cursor/skills`（**笔记**）。产品说明书在 `docs/`（**教科书**）。运行时产品 Agent 的 skills / rules 分层见 [skills-layers.md](./skills-layers.md)。

## 载体分层

| 载体 | 身份 | 例子 |
|------|------|------|
| 根 README | 终端用户为主 | 是什么、怎么跑、用户 FAQ |
| `docs/*` 专题 | 用户 · 集成 ·（部分）贡献 | 契约、配置、排障 |
| `docs/modules/` | 贡献 · 维护 | 文件落点 |
| `docs/maintainer.md` · `publishing.md` | **仅维护者** | 交接、发版 |
| `CONTRIBUTING.md` | 贡献 · 维护 | check、契约同步 |
| `AGENTS.md` · `.cursor/*` | 维护 · Coding Agent | 红线、改哪测哪 |
| Cursor Canvas | 维护者本人 | 本机路径；**不入库** |

## 写作标准

新文档或大改时必须遵守：

1. **文首读者**：`> **读者**：…`（中文半部）；英文半部用 `> **Audience**: …`。可多选，须诚实。
2. **中英双语（整篇对半）**：先写完整中文半部，用 `---` 分隔，再写镜像英文半部。**不要**在同一小节内交错「中文段 + 英文段」。发行说明（`docs/releases/v*`）可用中英并列节标题。代码注释：纯英文，或「中文。 / English.」；禁止仅中文注释。
3. **只写该身份需要的命令与概念**；发版步骤、Agent 禁令、本机绝对路径不进用户文。
4. **能力边界**指向 [status.md](./status.md)；未做只标「未做」，不写假 API。缺能力就写缺什么、怎么绕过或何时可用。
5. **改契约**必须改对应教科书 + status；改码红线只改笔记。
6. **用户语言**：标题与导航少用内部黑话。
7. **教科书语气**：陈述产品怎么用、契约是什么。禁止日记腔、自证腔、对照辩解（例如「我们没有抄某某」「不是 Fork」「非上游营销体」「对齐某某以自证」）。需要写边界时，用中性事实（「产品壳在 `apps/web`」「社区包经 Host 适配层接入」），不必点名否定第三方。
8. **配置优先 Settings UI**：终端用户路径写 **设置 → …**；环境变量留给 Host 启动 / CI / 无头。

## 按身份阅读路径

### 终端用户

1. [根 README](../README.md)  
2. [getting-started](./getting-started.md) · [configuration](./configuration.md)  
3. 卡住 → [troubleshooting](./troubleshooting.md)  
4. 想确认稳不稳 → [status](./status.md)

### 集成者（HTTP / Face / 工具）

1. [status](./status.md) · [architecture](./architecture.md)  
2. [http-api](./http-api.md) · [host-face](./host-face.md)  
3. Session：[session](./session.md) · [protocol-events](./protocol-events.md) · [session-compaction](./session-compaction.md)  
4. 工具：[tool-pipeline](./tool-pipeline.md) · [seams](./seams.md) · [policy](./policy.md)  
5. 社区插件：[community-plugins](./community-plugins.md) · [plugin-loader](./plugin-loader.md)  
6. 要义：[learn](./learn.md)

### 贡献者

1. [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md)  
2. [modules](./modules/README.md) · 相关契约专题  
3. 角色边界：[AGENTS](../AGENTS.md) 角色表（勿把红线抄进 PR 说明书）

### 维护者

1. **必读**：[maintainer](./maintainer.md)  
2. [publishing](./publishing.md) · [architecture](./architecture.md) · [adr/](./adr/README.md)  
3. [status](./status.md) · [learn](./learn.md) · [releases/](./releases/)  
4. 笔记：[AGENTS](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`

## 索引

全索引：[README.md](./README.md)。

---

# Documentation Audiences

> **Audience**: Maintainers · Contributors (documentation standards)

Before writing or handing off, identify **who** the document is for. Mixing audiences is the main reason docs become unusable.

## Four audiences

| Role | Goal | Entry | Do not include |
|------|------|-------|----------------|
| **End user** | Install CLI / open the web shell, connect a model, daily use | Root [README](../README.md) → [getting-started](./getting-started.md) | Release commands, package graphs, Agent red lines |
| **Integrator** | Wire HTTP / Face / SDK, author tools, configure MCP / policy, install community plugins | [status](./status.md) → [community-plugins](./community-plugins.md) · [http-api](./http-api.md) · [host-face](./host-face.md) | Local Canvas, `.cursor` notes |
| **Contributor** | Open PRs, change one package, add tests | [CONTRIBUTING](../CONTRIBUTING.md) → [testing](./testing.md) · [modules](./modules/README.md) | Fake APIs for unfinished work; secrets |
| **Maintainer** | Release, architecture, handoff, Agent notes | [maintainer](./maintainer.md) · [publishing](./publishing.md) · [AGENTS](../AGENTS.md) | Release FAQ dumped into the root README |

A Coding Agent is **not** a fifth product audience: it reads [AGENTS.md](../AGENTS.md) and `.cursor/*` (**notes**). Product manuals live under `docs/` (**textbook**). Runtime product Agent skills/rules layering: [skills-layers.md](./skills-layers.md).

## Document carriers

| Carrier | Audience | Examples |
|---------|----------|----------|
| Root README | End users first | What it is, how to run, user FAQ |
| `docs/*` topics | Users · integrators · (some) contributors | Contracts, config, troubleshooting |
| `docs/modules/` | Contributors · maintainers | File map |
| `docs/maintainer.md` · `publishing.md` | **Maintainers only** | Handoff, release |
| `CONTRIBUTING.md` | Contributors · maintainers | check, contract sync |
| `AGENTS.md` · `.cursor/*` | Maintainers · Coding Agent | Red lines, where to change/test |
| Cursor Canvas | The maintainer alone | Local paths; **do not commit** |

## Writing standards

When creating or substantially revising a document:

1. **Audience line**: Chinese half uses `> **读者**：…`; English half uses `> **Audience**: …`. Multiple roles are fine when honest.
2. **Bilingual (whole-document halves)**: Write the full Chinese half, then `---`, then a mirrored English half. **Do not** interleave Chinese and English paragraphs inside one section. Release notes under `docs/releases/v*` may keep paired CN/EN section titles. Code comments: English only, or `中文。 / English.`; never Chinese-only.
3. **Audience-scoped content only**; release steps, Agent prohibitions, and absolute local paths stay out of end-user docs.
4. **Capability truth** is [status.md](./status.md); unfinished work is **Not done**, never a fake API. Be honest about gaps and workarounds.
5. **Contract changes** update the textbook + status; coding red lines update notes only.
6. **User-facing titles** and navigation; avoid internal jargon.
7. **Textbook voice**: state how to use the product and what the contracts are. No diary voice, no self-justification, no contrast apologias (e.g. “we did not copy X”, “not a Fork”, “not upstream marketing”, “aligned with X to prove parity”). When a boundary matters, state the neutral fact (“the product shell lives in `apps/web`”, “community packages attach through the Host adapter”) without naming a third party to deny it.
8. **Settings UI first** for end users (**Settings → …**); env vars are for Host boot / CI / headless.

## Reading paths

### End user

1. [Root README](../README.md)  
2. [getting-started](./getting-started.md) · [configuration](./configuration.md)  
3. Stuck → [troubleshooting](./troubleshooting.md)  
4. Dependability → [status](./status.md)

### Integrator (HTTP / Face / tools)

1. [status](./status.md) · [architecture](./architecture.md)  
2. [http-api](./http-api.md) · [host-face](./host-face.md)  
3. Session: [session](./session.md) · [protocol-events](./protocol-events.md) · [session-compaction](./session-compaction.md)  
4. Tools: [tool-pipeline](./tool-pipeline.md) · [seams](./seams.md) · [policy](./policy.md)  
5. Community plugins: [community-plugins](./community-plugins.md) · [plugin-loader](./plugin-loader.md)  
6. Digest: [learn](./learn.md)

### Contributor

1. [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md)  
2. [modules](./modules/README.md) · related contracts  
3. Role table: [AGENTS](../AGENTS.md) (do not copy red lines into PR manuals)

### Maintainer

1. **Required**: [maintainer](./maintainer.md)  
2. [publishing](./publishing.md) · [architecture](./architecture.md) · [adr/](./adr/README.md)  
3. [status](./status.md) · [learn](./learn.md) · [releases/](./releases/)  
4. Notes: [AGENTS](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`

## Index

Full index: [README.md](./README.md).
