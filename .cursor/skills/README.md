# `.cursor/skills` — Coding Agent 笔记

> **读者**：在 Cursor 里**改 XRK-Harness 源码**的维护者 · Coding Agent。  
> **不是**终端用户在产品里用的 skill；产品 runtime skill 见 `templates/xrk-harness/skills/` 与用户工作区 `.xrk/skills/`。

## 与 XRK-AGT 对齐的分层

| 读者 | 放哪 | 写什么 |
|------|------|--------|
| **Coding Agent（改本仓）** | `.cursor/skills/xrk-*` · 根 `AGENTS.md` · `.cursor/rules` | Loader、preset、Face、extensions、Node 26 |
| **产品 Agent（跑 Harness）** | `{workspace}/.xrk/skills/*` · 种子 `templates/xrk-harness/skills/*` | 写插件、验证、选型；`/skill-name` 或 catalog |
| **人读契约** | `docs/*` | 现行行为；skill **索引** docs，不复制长规格 |

索引真源：[SKILL_INDEX.md](./SKILL_INDEX.md)。

## Frontmatter 约定

维护向 skill（本目录 `xrk-*`）：

```yaml
---
name: xrk-foo              # 与目录名一致，kebab-case
description: 一句话：何时加载（中文可）
disable-model-invocation: true
user-invocable: false
---
```

- **`disable-model-invocation`**：不进 Host `<available_skills>` catalog（避免维护笔记灌满产品 Agent）。
- **`user-invocable: false`**：无 `/xrk-foo` 斜杠展开。
- Cursor 仍可通过描述匹配加载；Host **不**注入（见 `.cursor/rules` 的 `xrk-inject: false`）。

产品 skill（种子 `templates/xrk-harness/skills/`）**只**写 `name` + `description`；正文用可执行步骤。见 skill **`xrk-workspace-skills`**。

## 推荐章节（维护向）

1. **权威入口** — `docs/` 路径 + 代码落点表  
2. **适用 / 非适用** — 避免误用  
3. **执行步骤** — 改码 checklist  
4. **常见陷阱** — 硬红线  

可略写「约定」表格代替长散文；**勿**把整份 `docs/` 复制进 skill。

## 相关

- [docs/skills-layers.md](../../docs/skills-layers.md)  
- [AGENTS.md](../../AGENTS.md)  
- 对照仓 XRK-AGT：`.cursor/skills/SKILL_INDEX.md`（框架 Core 技能；Harness 用进程插件 + preset 模型）
