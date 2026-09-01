---
name: xrk-create-skill
description: >-
  新建 XRKH 产品 skill（~/.xrk/skills 或工作区 .xrk/.agents/skills）。
  用户说「写 skill」「create skill」「自我升级」「教 agent」时使用。
---

# 创建产品 skill（自我升级）

对标 Cursor create-skill：**写进用户/工作区 skill 树**，不读 `~/.cursor/skills-cursor`。

## 落点（择一）

| 范围 | 路径 | 何时 |
|------|------|------|
| **产品默认（system data）** | `~/.xrk/skills/<name>/SKILL.md`（`XRK_HOME`） | **`xrkh web` 首次/启动**自动种子（缺才装） |
| **工作区（用户自建）** | `{workspace}/.xrk/skills/` 或 `.agents/skills/` | **仅当用户已建该目录或明确要求创建** |

产品 Agent **无权**在工作区自动 `mkdir` `.xrk`。会话/历史只写 system data，不写项目树。
需要补种时再开一次 `web` 或跑 `xrkh doctor`（同样只写 home）。

## 最小形

```yaml
---
name: my-skill
description: 何时用：用户说「…」；一句话做什么（触发语写进 description）
---
```

正文：短步骤；契约链到 `docs/`，勿整篇粘贴。

## 工程习惯（精简）

- 小而可组合；同名工作区覆盖 home  
- 非法 frontmatter 整 skill 丢弃 — 布尔字段写对  
- home skills 默认不进站立 catalog，靠 `skill` / `skill.list` 拉取（progressive disclosure）

## 完成后

请用户新开一轮或 `skill.list` 确认可见。全局种子随 **`xrkh web`** 写入 `~/.xrk/skills`（无需额外 CLI 开关）。
