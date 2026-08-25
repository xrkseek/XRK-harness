# 工作区注入

> **读者**：集成者 · 贡献者

产品上下文以**持久** `user/message` 事件注入，**不**写入三层 **system** 字符串。System 保留 persona / plugin `promptSections`，以稳定 prompt cache。

## 两层模型

**用户主目录 = 全局养 AI**，**工作区 = 项目覆盖**。

| 层 | 路径 | 优先级 |
|----|------|--------|
| **全局** | `~/.agents/` · `~/.xrk/` · `~/.claude/` · `~/.codex/` · `~/.cursor/rules/` | 低 |
| **工作区** | `{workspace}/.agents/` · `{workspace}/.xrk/` · 同上厂商路径 | 高 |

Inject 按节顺序追加；同名正文 dedupe；**后出现的节更接近当轮任务**。Skills catalog 同样：`~/…/skills` 低优先级，项目内高优先级。

## 产品目录

assistant / context / rules / recipes 默认：`{workspaceRoot}/.xrk`（**不强制 mkdir**）。

**Skills 不强制该目录。** Inject / `skill` / `skill.list` 自动导入已有 skill 树；缺目录则跳过。

工作区根及多厂商约定路径会进入 **agent-instructions**。`{workspaceRoot}/AGENTS.md` 与 `.cursor/rules/*.mdc` 在对应 workspace 为根时**会**注入（除非已有 `.agents/AGENTS.md` 或 `.xrk/AGENTS.md` 定义产品角色）。分层说明：[skills-layers.md](./skills-layers.md)。

## Skills 根

项目内（低 → 高优先级；同名后列覆盖）：

| 路径 | 说明 |
|------|------|
| `.codex/skills/` | Codex 兼容 |
| `.claude/skills/` | Claude Code |
| `.agents/skills/` | 厂商中立 |
| `.cursor/skills/` | Cursor |
| `.xrk/skills/` | XRK 原生叠加（优先） |

用户主目录下同相对路径（`~/.agents/skills` … `~/.xrk/skills`）亦扫描，供 **`skill` 工具** 与 Face `skill.list`。站立 **skill-catalog inject 默认只含工作区 skills**（避免数百个 home skill 每轮进日志）；需要时可设 `includeUserHomeSkills: true`。

## 持久注入（会话日志）

每轮开始（`turn/start` 之后、人类 `user/message` 之前），presets 调用 `appendWorkspaceInjectsIfChanged`：

| 载荷 | `user/message.source` | 模型侧正文 |
|------|----------------------|------------|
| Skill catalog（name + description） | `skill-catalog` · `form: catalog` | `<available_skills>` … |
| 多厂商约定 + `.xrk` 站立说明 | `agent-instructions` · `form: instructions` + `changes[]` | Markdown sections（`## path`） |

每条 inject（及人类 prompt）有唯一 `messageId`。Face wire `data.id` 使用该 id — **不是**裸 `turnId` — 以便同 turn 同时展示 inject 行与人类行而不挤掉对话。

Digest last-wins：未变 → 不新开行；已变 → 全量替换（catalog 上 `update: true`）。盘未变且会话已有 instructions **或** skill-catalog → `appendWorkspaceInjectsIfChanged` **整段跳过**（不重扫）。Skill **正文**仍经 `skill` 工具或 `/skill-name` 加载（见 [slash-recipes.md](./slash-recipes.md)）。

Face 聊天将非 `user` source 渲染为折叠的**上下文注入**行；Trajectory 按 producer 列出。

预算：字符上限（默认 32k，**设置 → 插件 → 插件配置 → 工作区注入** 的 `injectMaxChars`，或 Settings `workspace-inject.injectMaxChars`）→ durable inject 上的 `source.budgetTruncations[]`（会话可见）。

`workspace.previewInject` 仍返回 markdown `blocks`（含 skill 卡片）仅供 UI 预览 — **不**拷进 system。

## 顺序（instruction 节）

低 → 高优先级（后列更接近当轮任务）。**Skills 正文**仍为独立 catalog inject，不在此列表。

1. **用户主目录**：`~/.codex/AGENTS.md` · `~/.claude/*` · `~/.agents/AGENTS.md` · `~/.agents/rules/**` · `~/.agents/context/*` · `~/.cursor/rules/**` · `~/.xrk/` 站立文件
2. **工作区**：同上路径（无前缀）
3. `.github/copilot-instructions.md` · `.github/instructions/**`（仅工作区）
4. `{workspace}/.xrk/`：`SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` · `AGENTS.md` · `assistant.md` · `context/*` · `rules.md` · `subagents.md`
5. 工作区根 `AGENTS.md`（无 `.agents/` 或 `.xrk/AGENTS.md` 时）
6. 工作区根 `CLAUDE.md`（仅 `@AGENTS.md` 单行时跳过）
7. Skills → 独立 catalog inject

## 养 AI 放哪

| 目的 | 放哪 |
|------|------|
| 跨项目人格、语气、习惯 | `~/.agents/AGENTS.md` · `~/.agents/rules/` · `~/.xrk/SOUL.md` · `~/.xrk/USER.md` |
| 跨项目 skill | `~/.agents/skills/<name>/SKILL.md` |
| 单项目插件开发 / 架构 | 仓库内 `.agents/AGENTS.md` · `.agents/context/` · `.agents/skills/` |
| 本机私密偏好（不进 git） | `~/.xrk/` 或 `~/.agents/` |

存在 `.agents/AGENTS.md` 或 `.xrk/AGENTS.md` 时，工作区根 `AGENTS.md` **不**注入。

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  appendWorkspaceInjectsIfChanged,
  listSkillsFromWorkspace,
} from "@xrkseek/workspace";

const { blocks, durable, events } = await resolveWorkspaceInject({
  root: workspaceRoot,
});

await appendWorkspaceInjectsIfChanged({
  store,
  sessionId,
  turnId,
  now: Date.now,
  injectOptions: { root: workspaceRoot },
});
```

## Presets

`minimal` / `harness` 在 `assemble !== false` 时默认开启：

| 选项 | 含义 |
|------|------|
| omit / `true` | turn 开始时 durable inject + 多根 skill catalog |
| `false` | 跳过 inject |
| `{ productDir, maxChars }` | 调产品目录 / 预算 |

Composition 暴露 `composition.workspace`（`WorkspaceInjector`）供手动 inject。

斜杠：`{workspace}/.agents/recipes` 与 `{productDir}/recipes` 加 `/skill-name`（多根 skills）— 见 [slash-recipes.md](./slash-recipes.md)。`slashRecipes: false` 仅跳过 recipes。

参见：[host-preset.md](./host-preset.md) · [skills-layers.md](./skills-layers.md)

---

# Workspace Inject

> **Audience**: Integrators · Contributors

Product context is injected as **durable** `user/message` events, not into the three-layer **system** string. System keeps persona / plugin `promptSections` for prompt-cache stability.

## Two-layer model

**User home = global persona**; **workspace = project overlay**.

| Layer | Paths | Priority |
|-------|-------|----------|
| **Global** | `~/.agents/` · `~/.xrk/` · `~/.claude/` · `~/.codex/` · `~/.cursor/rules/` | Low |
| **Workspace** | `{workspace}/.agents/` · `{workspace}/.xrk/` · same vendor paths | High |

Sections append in order; duplicate bodies dedupe; **later sections are closer to the turn**. Skill catalog follows the same rule: `~/…/skills` is lower priority than project trees.

## Product dir

assistant / context / rules / recipes default to `{workspaceRoot}/.xrk` (**no forced mkdir**).

**Skills do not require that directory.** Inject / `skill` / `skill.list` import existing skill trees automatically; missing dirs are skipped.

Workspace-root and multi-vendor convention paths enter **agent-instructions**. `{workspaceRoot}/AGENTS.md` and `.cursor/rules/*.mdc` **are** injected when that workspace is the root (unless `.agents/AGENTS.md` or `.xrk/AGENTS.md` already defines the product role). Layering: [skills-layers.md](./skills-layers.md).

## Skills roots

In-project (low → high priority; later same names win):

| Path | Notes |
|------|-------|
| `.codex/skills/` | Codex-compatible |
| `.claude/skills/` | Claude Code |
| `.agents/skills/` | Vendor-neutral |
| `.cursor/skills/` | Cursor |
| `.xrk/skills/` | XRK-native overlay (wins) |

User-home trees with the same relative paths (`~/.agents/skills` … `~/.xrk/skills`) are also scanned for the **`skill` tool** and Face `skill.list`. The standing **skill-catalog inject defaults to workspace skills only** (avoids hundreds of home skills entering the log every turn); set `includeUserHomeSkills: true` to opt in.

## Durable inject (session log)

At each turn start (after `turn/start`, before the human `user/message`), presets call `appendWorkspaceInjectsIfChanged`:

| Payload | `user/message.source` | Model-facing body |
|---------|----------------------|-------------------|
| Skill catalog (name + description) | `skill-catalog` · `form: catalog` | `<available_skills>` … |
| Multi-vendor conventions + `.xrk` standing text | `agent-instructions` · `form: instructions` + `changes[]` | Markdown sections (`## path`) |

Each inject (and the human prompt) has a unique `messageId`. Face wire `data.id` uses that id — **not** a bare `turnId` — so inject rows and the human row can show in the same turn without crowding the dialogue.

Digest last-wins: unchanged → no new row; changed → full replace (`update: true` on catalog). When disk is unchanged and the session already has instructions **or** a skill-catalog, `appendWorkspaceInjectsIfChanged` **skips entirely** (no rescan). Skill **bodies** still load via the `skill` tool or `/skill-name` ([slash-recipes.md](./slash-recipes.md)).

Face chat renders non-`user` sources as folded **context inject** rows; Trajectory lists them by producer.

Budget: character cap (default 32k; **Settings → Plugins → Plugin configuration → Workspace inject** `injectMaxChars`, or Settings `workspace-inject.injectMaxChars`) → `source.budgetTruncations[]` on the durable inject (session-visible).

`workspace.previewInject` still returns markdown `blocks` (including skill cards) for UI preview only — **not** copied into system.

## Order (instruction sections)

Low → high priority (later rows closer to the turn). Skill **bodies** remain a separate catalog inject, not in this list.

1. **User home**: `~/.codex/AGENTS.md` · `~/.claude/*` · `~/.agents/AGENTS.md` · `~/.agents/rules/**` · `~/.agents/context/*` · `~/.cursor/rules/**` · `~/.xrk/` standing files
2. **Workspace**: same paths (no home prefix)
3. `.github/copilot-instructions.md` · `.github/instructions/**` (workspace only)
4. `{workspace}/.xrk/`: `SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` · `AGENTS.md` · `assistant.md` · `context/*` · `rules.md` · `subagents.md`
5. Workspace-root `AGENTS.md` (when neither `.agents/` nor `.xrk/AGENTS.md` exists)
6. Workspace-root `CLAUDE.md` (skipped when it is only a single `@AGENTS.md` line)
7. Skills → separate catalog inject

## Where to put persona

| Goal | Location |
|------|----------|
| Cross-project persona, tone, habits | `~/.agents/AGENTS.md` · `~/.agents/rules/` · `~/.xrk/SOUL.md` · `~/.xrk/USER.md` |
| Cross-project skill | `~/.agents/skills/<name>/SKILL.md` |
| Single-project plugin / architecture | In-repo `.agents/AGENTS.md` · `.agents/context/` · `.agents/skills/` |
| Local private preferences (not in git) | `~/.xrk/` or `~/.agents/` |

When `.agents/AGENTS.md` or `.xrk/AGENTS.md` exists, the workspace-root `AGENTS.md` is **not** injected.

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  appendWorkspaceInjectsIfChanged,
  listSkillsFromWorkspace,
} from "@xrkseek/workspace";

const { blocks, durable, events } = await resolveWorkspaceInject({
  root: workspaceRoot,
});

await appendWorkspaceInjectsIfChanged({
  store,
  sessionId,
  turnId,
  now: Date.now,
  injectOptions: { root: workspaceRoot },
});
```

## Presets

`minimal` / `harness` enable by default when `assemble !== false`:

| Option | Meaning |
|--------|---------|
| omit / `true` | Durable inject + multi-root skill catalog at turn start |
| `false` | Skip inject |
| `{ productDir, maxChars }` | Tune product dir / budget |

Composition exposes `composition.workspace` (`WorkspaceInjector`) for manual inject.

Slash: `{workspace}/.agents/recipes` and `{productDir}/recipes` plus `/skill-name` (multi-root skills) — see [slash-recipes.md](./slash-recipes.md). `slashRecipes: false` skips recipes only.

See also: [host-preset.md](./host-preset.md) · [skills-layers.md](./skills-layers.md)
