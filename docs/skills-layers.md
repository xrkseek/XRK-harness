# Skills 与 Rules 分层

> **读者**：集成者 · 终端用户（高级）

运行中的产品 Agent 从**全局**与**工作区**两层读取 rules 与 skills。同名时工作区覆盖全局。Inject 细节见 [workspace-inject.md](./workspace-inject.md)。

## 一览

| 种类 | 典型路径 | 进模型方式 |
|----|------|------------|
| **Rules / 站立说明** | `~/.agents/` · **`~/.xrk/`（产品数据根 / system data）** · `{workspace}/.agents/` · `{workspace}/.xrk/` · 工作区 `.cursor/rules/**` | 持久 `user/message` · `source: agent-instructions` |
| **Skills** | 工作区 `skills/<name>/SKILL.md`（**仅用户自建**）；home 经 `skill` 工具（**不含** `~/.cursor/skills`） | 工作区 → 站立 `skill-catalog`；home → `skill` 工具 / `skill.list`（catalog 默认不灌入） |

### 权限边界（产品 vs 用户）

| 谁 | 可以 | 不可以 |
|----|------|--------|
| **产品（XRKH）** | 在 **system data**（`XRK_HOME` / `~/.xrk`：会话库、设置、**启动时种子 `skills/`**）落盘 | **无权**在用户工作区自动 `mkdir` `.xrk` / `.agents` |
| **用户** | 自愿在工作区建 `.xrk/skills` 或 `.agents/skills` | — |

会话 / 聊天历史落在 system data（如 `~/.xrk/sessions`），不写入项目树。

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
| **CLI 用户种子** | **`xrkh web` / `serve` 启动时**自动把 `apps/cli/seeds/skills/*` 装入 **`~/.xrk/skills`**（system data；缺才装、不覆盖用户改过的 `SKILL.md`）。**绝不**在工作区 mkdir `.xrk` |
| `disable-model-invocation: true` | 不进 catalog、`skill` 工具拒绝 |
| `user-invocable: false` | `/skill-name` 不展开 |
| 非法布尔 frontmatter | **整 skill 丢弃**（fail-closed） |
| 优先级 | 工作区 > 用户主目录；同层内 **`.xrk` 原生优先**：`.xrk` → `.agents` → `.cursor` → `.claude` → `.codex`（**home 层无 `.cursor/skills`**） |

产品默认 playbook 在 **`apps/cli/seeds/skills/`**（`xrkh web` 装入 `~/.xrk/skills`）；写法**对标 Cursor** `create-skill` / `create-rule`，落点见 **`xrk-create-skill`**。

## 能力挂载（与人格分工）

| 层 | 管什么 | 典型落点 |
|----|--------|----------|
| **人格 / 站立** | 像谁、边界、语气 | `.agents/` 的 `IDENTITY` · `SOUL` · `TOOLS` · `AGENTS.md` |
| **MCP 挂载（默认）** | 模型可调外部工具 | 设置 → 插件 → MCP；见 [modules/mcp.md](./modules/mcp.md)「终端用户如何挂能力」 |
| **进程插件** | 仓库内自有 tools/prompt/commands | `extensions/<id>/` + `plugin add` + restart |

给 Agent 新工具时 **先 MCP Settings**，再考虑脚手架插件。产品剧本：skill **`xrk-capability-attach`**。

## Harness 源码仓写插件

以本仓库为工作区时，插件写在 **`extensions/<plugin-id>/`**。产品 Agent 读 **`.agents/`**（非仓库根 `AGENTS.md`）。

| 产品 skill（`.agents/skills/`） | 用途 |
|------------|------|
| **`xrk-capability-attach`** | 挂 MCP / 接外部工具（默认路径） |
| **`xrk-models-settings`** | 配模型：手动 ID、获取列表、对话搜索 |
| **`xrk-create-skill`** | 写 skill / standing（对标 Cursor） |
| **`xrk-harness-monorepo`** | monorepo 总控 |
| `xrk-plugin-kind` | kind / MCP / client 选型 |
| `xrk-plugin-author` | 写插件 |
| `xrk-plugin-verify` | 安装与验证 |

本仓产品面落点：`extensions/`（对照示例 `example-tools`）。

## 相关

- [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [plugin-development.md](./plugin-development.md) · [modules/mcp.md](./modules/mcp.md)
- Face：`skill.list`（`modelInvocable` · `userInvocable`）

---

# Skills and Rules Layers

> **Audience**: Integrators · End users (advanced)

The product Agent reads rules and skills from **global** and **workspace** layers. The workspace layer wins on clashes. Inject details: [workspace-inject.md](./workspace-inject.md).

## Overview

| Kind | Typical paths | How it reaches the model |
|----|------|------------|
| **Rules / standing instructions** | `~/.agents/` · **`~/.xrk/` (product system data)** · `{workspace}/.agents/` · `{workspace}/.xrk/` · workspace `.cursor/rules/**` | Durable `user/message` · `source: agent-instructions` |
| **Skills** | Workspace `skills/<name>/SKILL.md` (**user-created only**); home via `skill` tool (**excludes** `~/.cursor/skills`) | Workspace → standing `skill-catalog`; home → `skill` tool / `skill.list` (catalog excludes home by default) |

### Authority boundary (product vs user)

| Who | May | Must not |
|----|------|----------|
| **Product (XRKH)** | Write under **system data** (`XRK_HOME` / `~/.xrk`: sessions, settings, **`skills/` seeded on app start**) | **Auto-`mkdir`** `.xrk` / `.agents` inside the user’s workspace |
| **User** | Freely create workspace `.xrk/skills` or `.agents/skills` | — |

Chat / session history lives in system data (e.g. `~/.xrk/sessions`), not the project tree.

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
| **CLI user seeds** | On **`xrkh web` / `serve`**, install `apps/cli/seeds/skills/*` into **`~/.xrk/skills`** (system data; missing only, never overwrite edits). **Never** mkdir workspace `.xrk` |
| `disable-model-invocation: true` | Out of catalog; `skill` tool rejects |
| `user-invocable: false` | `/skill-name` does not expand |
| Illegal boolean frontmatter | **Whole skill discarded** (fail-closed) |
| Priority | Workspace > user home; within a layer **`.xrk` native wins**: `.xrk` → `.agents` → `.cursor` → `.claude` → `.codex` (**home layer has no `.cursor/skills`**) |

Default playbooks: **`apps/cli/seeds/skills/`** (`xrkh web` → `~/.xrk/skills`). Same shape as Cursor **`create-skill`** / **`create-rule`**; XRK paths in **`xrk-create-skill`**. Workspace overlay: this repo’s `.agents/skills/`.

## Capability attach (vs persona)

| Layer | Owns | Typical landing |
|----|------|----------|
| **Persona / standing** | Voice and boundaries | `.agents/` `IDENTITY` · `SOUL` · `TOOLS` · `AGENTS.md` |
| **MCP attach (default)** | External model-callable tools | Settings → Plugins → MCP; see [modules/mcp.md](./modules/mcp.md) “How end users attach capabilities” |
| **Process plugins** | In-repo tools/prompt/commands | `extensions/<id>/` + `plugin add` + restart |

Prefer **MCP Settings** before scaffolding a process plugin. Product playbook: skill **`xrk-capability-attach`**.

## Plugin authoring in this repo

When this repository is the workspace, plugins live under **`extensions/<plugin-id>/`**. The product Agent reads **`.agents/`** (not the repository-root `AGENTS.md`).

| Product skill (`.agents/skills/`) | Purpose |
|------------|------|
| **`xrk-capability-attach`** | Attach MCP / external tools (default path) |
| **`xrk-models-settings`** | Models: manual ID, provider fetch, chat search |
| **`xrk-create-skill`** | Author skills / standing (Cursor-shaped) |
| **`xrk-harness-monorepo`** | Monorepo router |
| `xrk-plugin-kind` | Choose kind / MCP / client |
| `xrk-plugin-author` | Author plugins |
| `xrk-plugin-verify` | Install and verify |

Product surface in this repo: `extensions/` (see `example-tools`).

## Related

- [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [plugin-development.md](./plugin-development.md) · [modules/mcp.md](./modules/mcp.md)
- Face: `skill.list` (`modelInvocable` · `userInvocable`)
