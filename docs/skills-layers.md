# Skills · Rules · 笔记分层

> **读者**：集成者 · 贡献者 · 维护者。

三套东西名字都像「skill / rules」，但**读者与运行时不同**。混用会导致：改本仓的 Coding Agent 笔记进产品 Agent 目录、或产品 skill 被当成发版红线。

## 一览

| 层 | 放哪 | 谁读 | 怎么进模型 |
|----|------|------|------------|
| **笔记** | [AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills` | 维护者 · **Cursor/Codex 改本仓** | **不**进 XRK Host 产品 Agent（见下） |
| **产品 rules / 说明** | `{workspace}/.xrk/assistant.md` · `rules.md` · `context/*` · `subagents.md` | 运行中的产品 Agent | 持久 `user/message` · `source: agent-instructions`（[workspace-inject](./workspace-inject.md)） |
| **产品 skills** | `{workspace}` 下 `.xrk|.agents|.claude|.codex|.cursor/skills`（及 `~/` 同名） | 运行中的产品 Agent | 目录 → `skill-catalog`；全文 → `skill` 工具或 `/skill-name` |

教科书（`docs/`）写契约；笔记写改码红线。标准：[audiences.md](./audiences.md)。

## 笔记（本仓 Coding Agent）

- **Rules**：`.cursor/rules/*.mdc`（常驻或 glob 挂载）— 例如 Node ≥26、产品身份、发行说明文体。
- **Skills**：`.cursor/skills/*/SKILL.md` — 长流程笔记（写文档身份、meter、发版）。
- 本仓这些 SKILL 文首标 `disable-model-invocation: true` 与 `user-invocable: false`，以免 `xrk-harness` 以本仓为 workspace 时把维护笔记灌进产品 Agent 目录。

Cursor 仍可按自己的机制读这些文件；**XRK 运行时**尊重上述 frontmatter。

## 产品 inject（rules / assistant）

不是 skill 目录。落在 `{workspace}/.xrk/`（可选，不强制建）：

| 文件 | 含义 |
|------|------|
| `assistant.md` | 人设 / 站立说明 |
| `rules.md` | 项目规则 |
| `context/*` | 附加上下文 |
| `subagents.md` | 子代理说明 |
| `recipes/*.yaml` | `/id` 斜杠配方 |

进 session 的是 **agent-instructions** 注入行，不是 system 大段（保 prompt cache）。每条 inject 与人类 prompt 都有独立 `messageId`（Face `data.id`），同 turn 不会挤掉对话行。详见 [workspace-inject.md](./workspace-inject.md)。

## 产品 skills（运行时）

| 机制 | 行为 |
|------|------|
| 多根导入 | 已存在的 vendor 目录自动扫；缺则跳过（不 mkdir） |
| `disable-model-invocation: true` | 不进 catalog、`skill` 工具拒绝（DSH 同名） |
| `user-invocable: false` | `/skill-name` 不展开 |
| 非法布尔 frontmatter | **整 skill 丢弃**（fail-closed） |
| 优先级 | 后列根覆盖同名：`.codex` → `.claude` → `.agents` → `.cursor` → `.xrk` |

用户项目里的 `.cursor/skills` **可以**是产品 skill（Cursor 布局兼容）。只有「给改 harness 源码用的笔记」才应打 `disable-model-invocation`。

## 相关

- [workspace-inject.md](./workspace-inject.md) · [slash-recipes.md](./slash-recipes.md) · [configuration.md](./configuration.md)
- Face：`skill.list`（带 `modelInvocable` / `userInvocable`）
