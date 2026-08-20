---
name: xrk-docs-audience
description: >-
  Write or revise XRK-Harness documentation with correct audience identity.
  Use when editing README, docs/*, CONTRIBUTING, AGENTS, or adding new markdown
  specs. Enforces textbook vs notes and reader banners for handoff clarity.
---

# 笔记 · 写文档按身份

教科书标准：[docs/audiences.md](../../../docs/audiences.md)。  
交接：[docs/maintainer.md](../../../docs/maintainer.md)。  
总则规则：`.cursor/rules/xrk-product-identity.mdc`。

## 动手前

1. 问：这篇给谁？终端用户 / 集成者 / 贡献者 / 维护者（可多选）。  
2. 文首写：`> **读者**：…`  
3. 只写该身份需要的命令与概念。

## 放哪儿

| 内容 | 位置 |
|------|------|
| 产品用法、契约、能力边界 | `docs/` · 根 README |
| 发版、交接清单 | `docs/maintainer.md` · `docs/publishing.md` |
| 改码红线、测哪些 | `AGENTS.md` · `.cursor/rules` · `.cursor/skills` |
| 本机路径、对照仓 | Canvas（不入库） |

## 勿做

- 根 README 写 `pnpm release` / Agent「不要合并」  
- 用户 FAQ 写发版  
- 未做能力写成已支持 API  
- 把 `.cursor` 笔记段落粘进 `docs/` 当规格  

## 改契约时同步

见 `CONTRIBUTING.md` 表；必碰 [docs/status.md](../../../docs/status.md)。  
Meter / compaction → 另开 skill `xrk-meter-session`。

## 检查

- [ ] 文首有读者行  
- [ ] 导航链回 [docs/README.md](../../../docs/README.md) 或 audiences  
- [ ] 用户文无发版口令、无本机绝对路径  
