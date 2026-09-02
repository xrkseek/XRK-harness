---
name: xrk-create-skill
description: >-
  写 XRK 产品 skill（对标 Cursor Agent Skill 结构）。用户说「写 skill」「create
  skill」「教 agent」「自我升级」时使用。
---

# Create skill（对标 Cursor create-skill）

**结构同 Cursor**：`skill-name/SKILL.md` + YAML frontmatter + 步骤/checklist。  
**落点不同** — 下表；勿写 `~/.cursor/skills-cursor/`。

## 放哪

| 范围 | 路径 |
|------|------|
| 跨项目习惯（默认） | `~/.xrk/skills/<name>/SKILL.md` |
| 仅本仓库 | `{workspace}/.agents/skills/` 或 `.xrk/skills/`（**须用户同意**再建目录） |
| 随 CLI 发布模板 | `apps/cli/seeds/skills/<name>/`（维护者双写） |

`xrkh web` 仅**缺才装** bundled seeds，不覆盖已有 `SKILL.md`。

## Frontmatter

```yaml
---
name: my-skill
description: >-
  WHAT + WHEN；含用户会说的触发语（中英均可）。
---
```

- 第三人称；一默认路径 + 一逃生口；正文宜 <500 行
- 非法布尔 frontmatter → 整 skill 丢弃

## Standing rules（对标 Cursor create-rule）

| Cursor | XRK |
|--------|-----|
| `.cursor/rules/*.mdc` | `.agents/AGENTS.md` · `rules.md` · `context/*` |
| `alwaysApply` | 写进 `AGENTS.md` 角色/边界 |
| `globs` | 任务 skill 或 `context/` 分文件 |

内核维护者改码用 `.cursor/rules/xrk-*`（不进 Host inject）。

## 写完

新 turn 或 `skill.list` 确认可见。维护者细则 → **`xrk-workspace-skills`**（Cursor 只读改 Harness 源码时）。
