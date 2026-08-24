# Skills 与 Rules 分层 / Skills and Rules Layers

> **读者 / Audience**：集成者 · 终端用户（高级） / Integrators · End users (advanced)

运行中的产品 Agent 从**全局**与**工作区**两层读取 rules 与 skills。同名时工作区覆盖全局。Inject 细节见 [workspace-inject.md](./workspace-inject.md)。

The product Agent reads rules and skills from **global** and **workspace** layers. The workspace layer wins on clashes. Inject details: [workspace-inject.md](./workspace-inject.md).

## 一览 / Overview

| 种类 / Kind | 典型路径 / Typical paths | 进模型方式 / How it reaches the model |
|----|------|------------|
| **Rules / 站立说明** | `~/.agents/` · `~/.xrk/` · `{workspace}/.agents/` · `{workspace}/.xrk/` · 多厂商约定路径 | 持久 `user/message` · `source: agent-instructions` |
| **Skills** | 同上目录下的 `skills/<name>/SKILL.md`（及 `~/.codex/skills` 等） | `skill-catalog` 注入 + `skill` 工具或 `/skill-name` 加载正文 |

## 站立文件（`.xrk/` 与 `.agents/`） / Standing files

可选目录，**不强制创建**。常用文件：

Optional directories; **never auto-created**. Common files:

| 文件 / File | 含义 / Meaning |
|------|------|
| `AGENTS.md` | 工作区角色与边界 / Workspace role and boundaries |
| `SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` | 人格与偏好 / Persona and preferences |
| `assistant.md` | 站立说明 / Standing instructions |
| `rules.md` | 项目规则 / Project rules |
| `context/*` | 附加上下文 / Extra context |
| `subagents.md` | 子代理说明 / Subagent notes |
| `recipes/*.yaml` | `/id` 斜杠配方 / Slash recipes |
| `skills/*/SKILL.md` | Skill 目录 / Skill trees |

## Skills（运行时） / Skills (runtime)

| 机制 / Mechanism | 行为 / Behavior |
|------|------|
| 多根导入 / Multi-root import | 已存在的目录自动扫；缺则跳过（不 mkdir） |
| `disable-model-invocation: true` | 不进 catalog、`skill` 工具拒绝 |
| `user-invocable: false` | `/skill-name` 不展开 |
| 非法布尔 frontmatter | **整 skill 丢弃**（fail-closed） |
| 优先级 / Priority | 用户主目录 → 工作区；同层内后列根覆盖：`.codex` → `.claude` → `.agents` → `.cursor` → `.xrk` |

## Harness 源码仓写插件 / Plugin authoring in this repo

以本仓库为工作区时，插件写在 **`extensions/<plugin-id>/`**。产品 Agent 读 **`.agents/`**（非仓库根 `AGENTS.md`）。

When this repository is the workspace, plugins live under **`extensions/<plugin-id>/`**. The product Agent reads **`.agents/`** (not the repository-root `AGENTS.md`).

| 产品 skill（`.agents/skills/`） | 用途 / Purpose |
|------------|------|
| **`xrk-harness-monorepo`** | monorepo 总控 / Monorepo router |
| `xrk-plugin-kind` | kind / MCP / client 选型 / Choose kind |
| `xrk-plugin-author` | 写插件 / Author plugins |
| `xrk-plugin-verify` | 安装与验证 / Install and verify |

对照 XRK-AGT：AGT 工作区写 `core/workspace-Core/` ↔ Harness 工作区写 `extensions/`。

## 相关 / Related

- [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [plugin-development.md](./plugin-development.md)
- Face：`skill.list`（`modelInvocable` · `userInvocable`）
