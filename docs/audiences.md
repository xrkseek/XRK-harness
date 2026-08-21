# 读者身份（文档体系标准）

写文档或交接前先认清**给谁看**。身份混用是文档难用的主因。

## 四种身份

| 身份 | 要做什么 | 从哪进 | 不该塞给他 |
|------|----------|--------|------------|
| **终端用户** | 装 CLI / 开网页、接模型、日常用壳 | 根 [README](../README.md) → [getting-started](./getting-started.md) | 发版命令、包依赖图、Agent 红线 |
| **集成者** | 接 HTTP / Face / SDK、写工具、配 MCP / policy | [status](./status.md) → [http-api](./http-api.md) · [host-face](./host-face.md) · 契约专题 | 本机 Canvas、`.cursor` 笔记 |
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

## 写作标准（新文档 / 大改时）

1. **文首一行读者**：`> **读者**：终端用户 · 集成者`（可多选，须诚实）。
2. **只写该身份需要的命令与概念**；发版、Agent 禁令、本机绝对路径不进用户文。
3. **能力边界**指向 [status.md](./status.md)；未做只标「未做」，不写假 API。
4. **改契约**必须改对应教科书 + status；改码红线只改笔记。
5. 标题与「我想…」导航用**用户语言**（「接模型」「MCP 连不上」），少用内部黑话。

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
5. 要义：[learn](./learn.md)

### 贡献者

1. [CONTRIBUTING](../CONTRIBUTING.md) · [testing](./testing.md)  
2. [modules](./modules/README.md) · 相关契约专题  
3. 角色边界：[AGENTS](../AGENTS.md) 角色表（勿把红线抄进 PR 说明书）

### 维护者 / 交接

1. **必读**：[maintainer](./maintainer.md)（交接清单）  
2. [publishing](./publishing.md) · [architecture](./architecture.md) · [adr/](./adr/README.md)  
3. [status](./status.md) · [learn](./learn.md) · [releases/](./releases/)  
4. 笔记：[AGENTS](../AGENTS.md) · `.cursor/rules` · `.cursor/skills`

## 索引

全索引：[README.md](./README.md)。
