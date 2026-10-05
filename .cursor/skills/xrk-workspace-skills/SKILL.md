---
name: xrk-workspace-skills
description: >-
  编写 Harness 产品 skill。新增或改 `apps/cli/seeds` 与本仓 **增量** `.agents/skills` 时使用。
disable-model-invocation: true
user-invocable: false
---

# 笔记 · 产品 skill / standing（Harness）

分层：[docs/skills-layers.md](../../../docs/skills-layers.md) · 注入：[docs/workspace-inject.md](../../../docs/workspace-inject.md)。

## 对标 Cursor（只写 XRK 差异）

| Cursor 产品 | XRK Harness |
|-------------|-------------|
| Skill 目录 + `SKILL.md` + frontmatter | **同形**；见下路径 |
| `create-skill`：WHAT+WHEN description、checklist、一默认路径 | 产品 skill **`xrk-create-skill`**（种子）教用户 |
| `~/.cursor/skills/` | **`~/.xrk/skills/`**（`xrkh web` 缺才装 seeds） |
| `.cursor/skills/`（项目） | **`{workspace}/.agents/skills/`** 或 `.xrk/skills/` |
| `.cursor/skills-cursor/`（内置） | **无**；维护者 **`.cursor/skills/xrk-*`**（`disable-model-invocation`） |
| `create-rule` · `.cursor/rules/*.mdc` | 工作区 **`.agents/AGENTS.md`** · **`rules.md`** · **`context/*`**（Host inject，非 `.mdc`） |
| 改内核 `.cursor/rules` | 本仓 **`.cursor/rules/xrk-*`**，`xrk-inject: false`，Cursor 改码用 |

**写法**：沿用 Cursor create-skill 的 description / 步骤 / 反模式；**只追加** XRK 路径、Settings 真按钮名、`settings.mutate` 须确认。

## 两套 skill，不要混

| 层 | 目录 | catalog |
|----|------|---------|
| 维护笔记 | `.cursor/skills/xrk-*` | 不进产品 catalog |
| 产品 skill | `.xrk/skills` · `.agents/skills` | 仅 `name` + `description` |

## 真源（禁止双写）

| 受众 | 路径 |
|------|------|
| 用户主目录（任意工作区） | **只** `apps/cli/seeds/skills/<name>/` → `~/.xrk/skills/` |
| 本仓作工作区增量 | `.agents/skills/<name>/` — **仅**本仓独有（如 `xrk-harness-monorepo`）；**禁止**再抄一份 seed 同名 skill |

UI 按钮名以 `packages/client/*/src/client/locales.ts` 为准。

## recipes

通用斜杠 → `apps/cli/seeds/recipes/`。本仓 `.agents/recipes/*.yaml` **只**放本仓独有（如 `/plugin-scaffold`），不与 seed 同 id。

## 新增 checklist

1. 跨工作区剧本：**只**写 `apps/cli/seeds/`，不要同步进 `.agents/`
2. `name` = 目录名；description 含触发语
3. [SKILL_INDEX.md](../SKILL_INDEX.md) · [docs/skills-layers.md](../../../docs/skills-layers.md)
4. 改 Settings 可见流程 → rule [`xrk-client-face-ui`](../../rules/xrk-client-face-ui.mdc)（产品 skill 只改 seeds）

## 陷阱

- 把 `xrk-plugin-dev` 复制到 `.xrk/skills`
- 在工作区 auto-mkdir `.xrk` / `.agents`
- 产品 skill 里写 Node 26 / 禁止 commit 等维护者红线
