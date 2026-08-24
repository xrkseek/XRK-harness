# Skills · Rules · 笔记分层 / Skills · Rules · Notes Layers

> **读者 / Audience**：集成者 · 贡献者 · 维护者 / Integrators · Contributors · Maintainers

三套东西名字都像「skill / rules」，但**读者与运行时不同**。混用会导致：改本仓的 Coding Agent 笔记进产品 Agent 目录、或产品 skill 被当成发版红线。

Three layers share skill/rules naming but differ in **audience and runtime**. Mixing them can inject Coding Agent notes into the product Agent directory, or treat product skills as release red lines.

## 一览 / Overview

| 层 / Layer | 放哪 / Location | 谁读 / Who reads | 怎么进模型 / How it reaches the model |
|----|------|------|------------|
| **笔记 / Notes** | [AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills` | 维护者 · **Cursor/Codex 改本仓** | 以该目录为 workspace 时：`AGENTS.md` · `.cursor/rules/*.mdc` → `agent-instructions`；维护向 `.cursor/skills` 可打 `disable-model-invocation` 不进 catalog |
| **产品 rules / 说明** | `{workspace}/.xrk/*` · 多厂商约定路径（见 [workspace-inject](./workspace-inject.md)） | 运行中的产品 Agent | 持久 `user/message` · `source: agent-instructions` |
| **产品 skills** | `{workspace}` 下 `.xrk|.agents|.claude|.codex|.cursor/skills`（及 `~/` 同名） | 运行中的产品 Agent | 目录 → `skill-catalog`；全文 → `skill` 工具或 `/skill-name` |

教科书（`docs/`）写契约；笔记写改码红线。标准：[audiences.md](./audiences.md)。

Textbooks under `docs/` describe contracts; notes describe coding red lines. Standard: [audiences.md](./audiences.md).

## 笔记（本仓 Coding Agent） / Notes (in-repo Coding Agent)

- **Rules**：`.cursor/rules/*.mdc` — 以该仓库为 workspace 时由 Host 注入；Cursor 自身亦可能读取。
- **Skills**：`.cursor/skills/*/SKILL.md` — 长流程笔记（写文档身份、meter、发版）。
- 本仓维护向 SKILL 文首标 `disable-model-invocation: true` 与 `user-invocable: false`，以免 catalog 灌满维护笔记；**rules / AGENTS.md 仍会注入**。

When this repo is the workspace, Host injects rules and root `AGENTS.md`. Maintenance skills should set `disable-model-invocation` so the catalog stays lean.

## 产品 inject（rules / assistant） / Product inject

不是 skill 目录。落在 `{workspace}/.xrk/`（可选，不强制建）：

Not a skill directory. Lives under `{workspace}/.xrk/` (optional; not forced):

| 文件 / File | 含义 / Meaning |
|------|------|
| `SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` · `AGENTS.md` | 种子站立文件 / Seed standing files |
| `assistant.md` | 人设 / 站立说明 / Persona / standing instructions |
| `rules.md` | 项目规则 / Project rules |
| `context/*` | 附加上下文 / Extra context |
| `subagents.md` | 子代理说明 / Subagent notes |
| `recipes/*.yaml` | `/id` 斜杠配方 / Slash recipes |

进 session 的是 **agent-instructions** 注入行，不是 system 大段（保 prompt cache）。每条 inject 与人类 prompt 都有独立 `messageId`（Face `data.id`）。详见 [workspace-inject.md](./workspace-inject.md)。

Session receives **agent-instructions** inject rows, not a large system blob (prompt-cache stability). Each inject and the human prompt has its own `messageId`.

## 产品 skills（运行时） / Product skills (runtime)

| 机制 / Mechanism | 行为 / Behavior |
|------|------|
| 多根导入 / Multi-root import | 已存在的目录自动扫；缺则跳过（不 mkdir） |
| `disable-model-invocation: true` | 不进 catalog、`skill` 工具拒绝 |
| `user-invocable: false` | `/skill-name` 不展开 |
| 非法布尔 frontmatter | **整 skill 丢弃**（fail-closed） |
| 优先级 / Priority | 后列根覆盖同名：`.codex` → `.claude` → `.agents` → `.cursor` → `.xrk` |

用户项目里的 `.cursor/skills` **可以**是产品 skill。只有「给改 harness 源码用的笔记」才应打 `disable-model-invocation`。

`.cursor/skills` in a user project **may** be product skills. Only notes for editing harness source should set `disable-model-invocation`.

## 相关 / Related

- [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [configuration.md](./configuration.md)
- Face：`skill.list`（带 `modelInvocable` / `userInvocable`）
