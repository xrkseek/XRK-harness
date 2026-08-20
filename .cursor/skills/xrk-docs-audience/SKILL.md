---
name: xrk-docs-audience
description: >-
  Write or revise XRK-Harness documentation with correct audience identity.
  Use when editing README, docs/*, CONTRIBUTING, AGENTS, or adding new markdown
  specs. Enforces textbook vs notes; forbids meta disclaimers in user docs.
---

# 笔记 · 写文档按身份

教科书标准：[docs/audiences.md](../../../docs/audiences.md)。  
交接：[docs/maintainer.md](../../../docs/maintainer.md)。  
总则规则：`.cursor/rules/xrk-product-identity.mdc`。

## 动手前

1. 问：这篇给谁？终端用户 / 集成者 / 贡献者 / 维护者（可多选）。  
2. 文首只写：`> **读者**：…`（一句身份，勿夹「请去看某某」旁白）。  
3. 只写该身份需要的命令、事实与契约。

## 放哪儿

| 内容 | 位置 |
|------|------|
| 产品用法、契约、能力边界 | `docs/` · 根 README |
| 发版、交接清单 | `docs/maintainer.md` · `docs/publishing.md` |
| 发行说明（`docs/releases/v*`） | rule + skill `xrk-release-notes`（DSH 风：新增/完善/删除/修复） |
| 改码红线、测哪些、Agent 禁令 | `AGENTS.md` · `.cursor/rules` · `.cursor/skills` |
| 本机路径、对照仓 | Canvas（不入库） |

## 根 README

- 写：是什么、怎么跑、能用到什么程度、用户 FAQ、开发入口链接表。  
- **不要写**：发版步骤、`pnpm release`、「不写某某因为那是维护者流程」、Agent「不要合并」类禁令、教科书 vs 笔记元叙事。  
- 开发者只需一节链接表指向 CONTRIBUTING / maintainer / publishing / AGENTS。

## 语气

- 直接陈述事实与步骤；删「可忽略本节」「不在本页展开」「那是维护者自己的事」等自我提醒。  
- 身份分流靠**选对文件**，不靠在用户文里解释「为什么不写」。  
- 本机 PATH / IDE Node 抢路径等细节放 [troubleshooting](../../../docs/troubleshooting.md)，不塞进根 README 开篇。

## 勿做

- 把笔记红线抄进用户说明书  
- 未做能力写成已支持 API  
- 把 `.cursor` 段落粘进 `docs/` 当规格  
- 在用户 FAQ 塞发版  

## 改契约时同步

见 `CONTRIBUTING.md` 表；必碰 [docs/status.md](../../../docs/status.md)。  
Meter / compaction → skill `xrk-meter-session`。

## 检查

- [ ] 文首有简洁读者行  
- [ ] 无元旁白（「不写…」「可忽略…」「见文末维护流程」）  
- [ ] 用户文无发版口令、无本机绝对路径  
- [ ] 导航能回到 [docs/README.md](../../../docs/README.md) 或 audiences  
