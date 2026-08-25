# Skills 与 Rules 分层

> **读者**：集成者 · 终端用户（高级）

运行中的产品 Agent 从**全局**与**工作区**两层读取 rules 与 skills。同名时工作区覆盖全局。Inject 细节见 [workspace-inject.md](./workspace-inject.md)。

## 一览

| 种类 | 典型路径 | 进模型方式 |
|----|------|------------|
| **Rules / 站立说明** | `~/.agents/` · `~/.xrk/` · `{workspace}/.agents/` · `{workspace}/.xrk/` · 多厂商约定路径 | 持久 `user/message` · `source: agent-instructions` |
| **Skills** | 同上目录下的 `skills/<name>/SKILL.md`（及 `~/.codex/skills` 等） | 工作区 → 站立 `skill-catalog`；主目录 → `skill` 工具 / `skill.list`（catalog 默认不灌入） |

## 站立文件（`.xrk/` 与 `.agents/`）

可选目录，**不强制创建**。常用文件：

| 文件 | 含义 |
|------|------|
| `AGENTS.md` | 工作区角色与边界 |
| `SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` | 人格与偏好 |
| `assistant.md` | 站立说明 |
| `rules.md` | 项目规则 |
| `context/*` | 附加上下文 |
| `subagents.md` | 子代理说明 |
| `recipes/*.yaml` | `/id` 斜杠配方 |
| `skills/*/SKILL.md` | Skill 目录 |

## Skills（运行时）

| 机制 | 行为 |
|------|------|
| 多根导入 | 已存在的目录自动扫；缺则跳过（不 mkdir） |
| `disable-model-invocation: true` | 不进 catalog、`skill` 工具拒绝 |
| `user-invocable: false` | `/skill-name` 不展开 |
| 非法布尔 frontmatter | **整 skill 丢弃**（fail-closed） |
| 优先级 | 用户主目录 → 工作区；同层内后列根覆盖：`.codex` → `.claude` → `.agents` → `.cursor` → `.xrk` |

## Harness 源码仓写插件

以本仓库为工作区时，插件写在 **`extensions/<plugin-id>/`**。产品 Agent 读 **`.agents/`**（非仓库根 `AGENTS.md`）。

| 产品 skill（`.agents/skills/`） | 用途 |
|------------|------|
| **`xrk-harness-monorepo`** | monorepo 总控 |
| `xrk-plugin-kind` | kind / MCP / client 选型 |
| `xrk-plugin-author` | 写插件 |
| `xrk-plugin-verify` | 安装与验证 |

本仓产品面落点：`extensions/`（对照示例 `example-tools`）。

## 相关

- [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [plugin-development.md](./plugin-development.md)
- Face：`skill.list`（`modelInvocable` · `userInvocable`）

---

# Skills and Rules Layers

> **Audience**: Integrators · End users (advanced)

The product Agent reads rules and skills from **global** and **workspace** layers. The workspace layer wins on clashes. Inject details: [workspace-inject.md](./workspace-inject.md).

## Overview

| Kind | Typical paths | How it reaches the model |
|----|------|------------|
| **Rules / standing instructions** | `~/.agents/` · `~/.xrk/` · `{workspace}/.agents/` · `{workspace}/.xrk/` · multi-vendor convention paths | Durable `user/message` · `source: agent-instructions` |
| **Skills** | `skills/<name>/SKILL.md` under those trees (and `~/.codex/skills`, etc.) | Workspace → standing `skill-catalog`; home → `skill` tool / `skill.list` (catalog excludes home by default) |

## Standing files (`.xrk/` and `.agents/`)

Optional directories; **never auto-created**. Common files:

| File | Meaning |
|------|------|
| `AGENTS.md` | Workspace role and boundaries |
| `SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` | Persona and preferences |
| `assistant.md` | Standing instructions |
| `rules.md` | Project rules |
| `context/*` | Extra context |
| `subagents.md` | Subagent notes |
| `recipes/*.yaml` | `/id` slash recipes |
| `skills/*/SKILL.md` | Skill trees |

## Skills (runtime)

| Mechanism | Behavior |
|------|------|
| Multi-root import | Scan existing dirs; skip missing (no mkdir) |
| `disable-model-invocation: true` | Out of catalog; `skill` tool rejects |
| `user-invocable: false` | `/skill-name` does not expand |
| Illegal boolean frontmatter | **Whole skill discarded** (fail-closed) |
| Priority | User home → workspace; within a layer later roots win: `.codex` → `.claude` → `.agents` → `.cursor` → `.xrk` |

## Plugin authoring in this repo

When this repository is the workspace, plugins live under **`extensions/<plugin-id>/`**. The product Agent reads **`.agents/`** (not the repository-root `AGENTS.md`).

| Product skill (`.agents/skills/`) | Purpose |
|------------|------|
| **`xrk-harness-monorepo`** | Monorepo router |
| `xrk-plugin-kind` | Choose kind / MCP / client |
| `xrk-plugin-author` | Author plugins |
| `xrk-plugin-verify` | Install and verify |

Product surface in this repo: `extensions/` (see `example-tools`).

## Related

- [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [plugin-development.md](./plugin-development.md)
- Face: `skill.list` (`modelInvocable` · `userInvocable`)
