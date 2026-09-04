# 工作区注入

> **读者**：集成者 · 贡献者

产品上下文以**持久** `user/message` 事件注入，**不**写入三层 **system** 字符串。System 保留 persona / plugin `promptSections`，以稳定 prompt cache。

## 两层模型

**用户主目录 = 全局养 AI**，**工作区 = 项目覆盖**。

| 层 | 路径 | 优先级 |
|----|------|--------|
| **全局** | `~/.codex/` · `~/.claude/` · `~/.agents/` · `~/.xrk/` | 低 |
| **工作区** | `{workspace}/` 下同厂商路径 + `.xrk/` | 高 |

Inject 按节顺序追加；同名正文 dedupe；**后出现的节更接近当轮任务**。Skills catalog 同样：home 低优先级，项目内高优先级。

**真源**：`packages/workspace/src/inject-sources.ts`（`HOME_CONVENTION_INJECT` · `WORKSPACE_CONVENTION_INJECT` · skill 根列表）。

## 注入策略（Codex 对齐）

与 Codex 相同的核心原则：**instructions 窄、skills 渐进披露**。

| 种类 | 全局 `~/…` | 工作区 `{root}/…` |
|------|------------|-------------------|
| **Instructions** | `.codex/AGENTS.md` · `.claude/*` · `.agents/*` · `~/.xrk/` 站立文件 | 同上 + `CODEX.md` · `.cursor/rules/**` · `.github/*` · 根 `AGENTS.md`/`CLAUDE.md`（有产品 overlay 时跳过根 `AGENTS.md`） |
| **`~/.cursor/**`** | **永不注入**（Cursor IDE 维护树） | — |
| **`{root}/.cursor/rules/**`** | — | **注入**（单文件 `xrk-inject: false` 可跳过） |
| **Skill catalog** | 默认**不含** home skills | **`.xrk/skills`** → `.agents` → `.cursor` → `.claude` → `.codex`（兼容） |
| **Skill 工具 / `skill.list`** | **`~/.xrk/skills`** · `~/.agents` · `~/.claude` · `~/.codex`（**不含** `~/.cursor/skills`） | 同上 + `{productDir}/skills` |

跨项目人格放 **`~/.agents/`** 或 **`~/.xrk/`**，不要放 **`~/.cursor/`**。

## 产品目录

assistant / context / rules / recipes 默认：`{workspaceRoot}/.xrk`（**不强制 mkdir**）。

**Skills 不强制该目录。** Inject / `skill` / `skill.list` 自动导入已有 skill 树；缺目录则跳过。

存在 `{workspace}/.agents/AGENTS.md` 或 `{workspace}/.xrk/AGENTS.md` 时，工作区根 `AGENTS.md` **不**注入。分层说明：[skills-layers.md](./skills-layers.md)。

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

1. **用户主目录**（`HOME_CONVENTION_INJECT`）：`~/.codex/AGENTS.md` · `~/.claude/*` · `~/.agents/*` · `~/.xrk/` 站立文件
2. **工作区**（`WORKSPACE_CONVENTION_INJECT`）：同上 + `CODEX.md` · `.cursor/rules/**` · `.github/*`
3. `{workspace}/.xrk/`：`SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` · `AGENTS.md` · `assistant.md` · `context/*` · `rules.md` · `subagents.md`
4. 工作区根 `AGENTS.md`（无 `.agents/` 或 `.xrk/AGENTS.md` 时）
5. 工作区根 `CLAUDE.md`（仅 `@AGENTS.md` 单行时跳过）
6. Skills → 独立 catalog inject（仅工作区根，除非 `includeUserHomeSkills: true`）

## 养 AI 放哪

| 目的 | 放哪 |
|------|------|
| 跨项目默认偏好（产品种子） | `~/.xrk/AGENTS.md`（`xrkh web` 写入；薄全局说明，对标 Codex；**不**自动种 SOUL/IDENTITY） |
| 跨项目人格、语气、习惯 | `~/.agents/AGENTS.md` · `~/.agents/rules/` · 自写 `~/.xrk/SOUL.md` · `USER.md` |
| 跨项目 skill | `~/.agents/skills/<name>/SKILL.md` |
| 单项目规则（含 Cursor 格式） | `{workspace}/.cursor/rules/*.mdc`（**不是** `~/.cursor/rules`） |
| 单项目插件开发 / 架构 | 仓库内 `.agents/AGENTS.md` · `.agents/context/` · `.agents/skills/` |
| 本机私密偏好（不进 git） | `~/.xrk/` 或 `~/.agents/` |

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  appendWorkspaceInjectsIfChanged,
  listSkillsFromWorkspace,
  HOME_CONVENTION_INJECT,
  WORKSPACE_CONVENTION_INJECT,
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
| `includeUserHomeSkills: true` | standing catalog 也含 `~/…/skills`（默认 false） |

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
| **Global** | `~/.codex/` · `~/.claude/` · `~/.agents/` · `~/.xrk/` | Low |
| **Workspace** | Same vendor paths under `{workspace}/` + `.xrk/` | High |

Sections append in order; duplicate bodies dedupe; **later sections are closer to the turn**. Skill catalog follows the same rule: home is lower priority than project trees.

**Source of truth**: `packages/workspace/src/inject-sources.ts` (`HOME_CONVENTION_INJECT` · `WORKSPACE_CONVENTION_INJECT` · skill root lists).

## Inject policy (Codex-aligned)

Same core principle as Codex: **narrow instructions, progressive skill disclosure**.

| Kind | Global `~/…` | Workspace `{root}/…` |
|------|--------------|----------------------|
| **Instructions** | `.codex/AGENTS.md` · `.claude/*` · `.agents/*` · `~/.xrk/` standing files | Same + `CODEX.md` · `.cursor/rules/**` · `.github/*` · root `AGENTS.md`/`CLAUDE.md` (root `AGENTS.md` skipped when product overlay exists) |
| **`~/.cursor/**`** | **Never injected** (Cursor IDE maintainer tree) | — |
| **`{root}/.cursor/rules/**`** | — | **Injected** (per-file opt-out via `xrk-inject: false`) |
| **Skill catalog** | Home skills **excluded by default** | **`.xrk/skills`** → `.agents` → `.cursor` → `.claude` → `.codex` (compat) |
| **`skill` tool / `skill.list`** | **`~/.xrk/skills`** · `~/.agents` · `~/.claude` · `~/.codex` (**excludes** `~/.cursor/skills`) | Same + `{productDir}/skills` |

Put cross-project persona under **`~/.agents/`** or **`~/.xrk/`**, not **`~/.cursor/`**.

## Product dir

assistant / context / rules / recipes default to `{workspaceRoot}/.xrk` (**no forced mkdir**).

**Skills do not require that directory.** Inject / `skill` / `skill.list` import existing skill trees automatically; missing dirs are skipped.

When `{workspace}/.agents/AGENTS.md` or `{workspace}/.xrk/AGENTS.md` exists, the workspace-root `AGENTS.md` is **not** injected. Layering: [skills-layers.md](./skills-layers.md).

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

1. **User home** (`HOME_CONVENTION_INJECT`): `~/.codex/AGENTS.md` · `~/.claude/*` · `~/.agents/*` · `~/.xrk/` standing files
2. **Workspace** (`WORKSPACE_CONVENTION_INJECT`): same + `CODEX.md` · `.cursor/rules/**` · `.github/*`
3. `{workspace}/.xrk/`: `SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` · `AGENTS.md` · `assistant.md` · `context/*` · `rules.md` · `subagents.md`
4. Workspace-root `AGENTS.md` (when neither `.agents/` nor `.xrk/AGENTS.md` exists)
5. Workspace-root `CLAUDE.md` (skipped when it is only a single `@AGENTS.md` line)
6. Skills → separate catalog inject (workspace roots only unless `includeUserHomeSkills: true`)

## Where to put persona

| Goal | Location |
|------|----------|
| Cross-project defaults (product seed) | `~/.xrk/AGENTS.md` (`xrkh web`; thin Codex-style globals; **does not** auto-seed SOUL/IDENTITY) |
| Cross-project persona, tone, habits | `~/.agents/AGENTS.md` · `~/.agents/rules/` · hand-authored `~/.xrk/SOUL.md` · `USER.md` |
| Cross-project skill | `~/.agents/skills/<name>/SKILL.md` |
| Project rules (including Cursor format) | `{workspace}/.cursor/rules/*.mdc` (**not** `~/.cursor/rules`) |
| Single-project plugin / architecture | In-repo `.agents/AGENTS.md` · `.agents/context/` · `.agents/skills/` |
| Local private preferences (not in git) | `~/.xrk/` or `~/.agents/` |

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  appendWorkspaceInjectsIfChanged,
  listSkillsFromWorkspace,
  HOME_CONVENTION_INJECT,
  WORKSPACE_CONVENTION_INJECT,
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
| `includeUserHomeSkills: true` | Standing catalog also includes `~/…/skills` (default false) |

Composition exposes `composition.workspace` (`WorkspaceInjector`) for manual inject.

Slash: `{workspace}/.agents/recipes` and `{productDir}/recipes` plus `/skill-name` (multi-root skills) — see [slash-recipes.md](./slash-recipes.md). `slashRecipes: false` skips recipes only.

See also: [host-preset.md](./host-preset.md) · [skills-layers.md](./skills-layers.md)
