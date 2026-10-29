# 工作区注入

> **读者**：集成者 · 贡献者

产品上下文以**持久** `user/message` 事件注入，**不**写入三层 **system** 字符串。System 保留 persona / plugin `promptSections`，以稳定 prompt cache。

回合级 / 可重算的 ephemeral 上下文走 **[context-fragments](./context-fragments.md)**（`additional_context` · recap · …），与本文 inject **分层**，不要混进 skill-catalog / agent-instructions。

## 两层模型

**用户主目录 = 全局养 AI**，**工作区 = 项目覆盖**。

| 层 | 路径 | 优先级 |
|----|------|--------|
| **全局** | `~/.codex/` · `~/.claude/` · `~/.agents/` · `~/.xrk/` | 低 |
| **工作区** | `{workspace}/` 下同厂商路径 + `.xrk/` | 高 |

Inject 按节顺序追加；同名正文 dedupe；**后出现的节更接近当轮任务**。Skills catalog 同样：home 低优先级，项目内高优先级。节渲染带 `> source: <path>` 溯源行（压缩后仍可辨来源）。

**Audience**：只闸 **经理 ledger `XRK.md`**（`audience=user` 才注；干员家 / 委派子会话不注）。产品站立、家约定（`~/.agents` · `~/.claude` · `~/.codex`）、工作区约定、skill catalog **全席同注**（存在都尝试）。徽章与权限只管**工具运行时面**，不管上下文。渐进披露 = catalog 列名 → `skill` 拉正文，不是少注约定。权威车道见 `<instruction_authority>`（`createInstructionAuthorityRegistry`，插件可 `register`）。

**真源**：`packages/workspace/src/inject-sources.ts`（`HOME_CONVENTION_INJECT` · `WORKSPACE_CONVENTION_INJECT` · skill 根列表）· `ecosystem-instructions.ts` · `workspace-anchor.ts`。

## 注入策略（Codex 对齐）

与 Codex 相同的核心原则：**instructions 窄、skills 渐进披露**（catalog 列 name+一行 → `skill` 拉正文；**没有** `skill_search`——`tool_search` 只服务延迟工具）。Catalog 截断头序：**公文包**（干员/其子会话）→ **工作区 + 种子 `xrk-*`** → 其它全局；同名冲突公文包赢。

| 种类 | 全局 `~/…` | 工作区 `{root}/…` |
|------|------------|-------------------|
| **产品站立** | **`~/.xrk/`**（AGENTS/SOUL/USER/IDENTITY/TOOLS …；全席） | `{workspace}/.xrk/` 同形 overlay |
| **约定 Instructions** | `.codex/AGENTS.md` · `.claude/*` · `.agents` AGENTS/rules/context（**全席**） | **存在都尝试注入**（多智能体同仓）：`.codex/` · `CODEX.md` · `.claude/` · `.agents/` · `.cursor/rules/**` · `.github/*` · 根 `AGENTS.md`/`CLAUDE.md` · 与 `.xrk/` **并行**（内容去重；单文件 `xrk-inject: false` 跳过） |
| **经理 ledger `XRK.md`** | **`~/.xrk/XRK.md`**（站立种子 · fingerprint，同 AGENTS；仅 `audience=user`）· 遗留 **`~/XRK.md`** | **`{workspace}/.xrk/XRK.md`**（同 AGENTS overlay）· 遗留根 **`XRK.md`**；干员家 / 委派子会话不注 |
| **`~/.cursor/**`** | **永不注入**（Cursor IDE 维护树） | — |
| **`{root}/.cursor/rules/**`** | — | **注入**（单文件 `xrk-inject: false` 可跳过） |
| **Skill catalog / `skill` 工具 / `skill.list` / `/skills`** | **始终含** `{XRK_HOME}/skills`（产品种子 **与** 用户安装）；其它 `~/…/skills` 默认关 | 候选同形；**截断/展示头序**：公文包 → 工作区+`xrk-*` → 全局。同名公文包赢。无 `skill_search` |

跨项目人格写 **`~/.xrk/`**（或工作区 `.xrk/`）；业界约定写 **`~/.agents/`**（AGENTS/rules/context/skills）。不要放 **`~/.cursor/`**。

## 产品目录

assistant / context / rules / recipes 默认：`{workspaceRoot}/.xrk`（**不强制 mkdir**）。

**Skills 不强制该目录。** Inject / `skill` / `skill.list` 自动导入已有 skill 树；缺目录则跳过。

工作区里各厂商约定目录 **存在都尝试注入**（不是互斥二选一）：`.agents/` · `.claude/` · `.cursor/rules/` · `.codex/` · `CODEX.md` · `.github/` · 根 `AGENTS.md`/`CLAUDE.md` · `.xrk/` 站立——方便 Cursor / Claude / Codex / 本产品 Agent 同仓协作。内容去重；同一份手册只留一处；维护者笔记用 `xrk-inject: false`。家目录 `~/.cursor/**` 仍不注（IDE 维护树）。分层说明：[skills-layers.md](./skills-layers.md)。

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

1. **产品站立** `~/.xrk/` AGENTS/SOUL/…（全席；`includeUserHome` 默认开）
2. **家约定**（`HOME_CONVENTION_INJECT`；**全席**）：`~/.codex/AGENTS.md` · `~/.claude/*` · `~/.agents` AGENTS/rules/context
3. **经理 ledger**（仅 `audience=user`）：站立 `~/.xrk/XRK.md`（+ 遗留 `~/XRK.md`）
4. **工作区约定**（`WORKSPACE_CONVENTION_INJECT`；**存在都注**）：`.codex/AGENTS.md` · `CODEX.md` · `.claude/CLAUDE.md`+`rules/` · `.agents` AGENTS/rules/context · `.cursor/rules/**` · `.github/*`
5. `{workspace}/.xrk/`：`SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` · `AGENTS.md` · `assistant.md` · `context/*` · `rules.md` · `subagents.md`；同档 **`XRK.md`**（仅 user）
6. 工作区根 `AGENTS.md`（始终尝试；`xrk-inject: false` 跳过）；遗留根 `XRK.md`（仅 user，顺序在约定层）
7. 工作区根 `CLAUDE.md`（仅 `@AGENTS.md` 单行时跳过）
8. Skills → 独立 catalog inject（见上表；产品家 `{XRK_HOME}/skills` 始终入表）

锚点段（`resolveWorkspaceInject`）：`## Workspace root` → 可选 `## Product home`（绝对路径）→ 可选 `## Runtime surface` → 可选 `## Session policy`。

## 运行形态（Runtime surface）

工作区根锚点（`## Workspace root`）同一节内还会追加 `## Product home`（产品数据根绝对路径）与 `## Runtime surface` 段 —— 后者**仅当**入口声明了形态，让模型知道人在看哪种壳：

| `XRK_SURFACE` | 壳 |
|---------------|----|
| `desktop` | Electron 桌面端（原生选文件/目录 · `host.openPath` · framed pipes，无浏览器标签） |
| `web` | 浏览器标签（`xrkh web` / `serve`） |
| `tui` · `acp` · `cli` | 终端 TUI · ACP 会话 · 无头 `run` |

由各入口自动声明（CLI `serve`/`web` → `web`、`run` → `cli`、`acp` → `acp`；Desktop Host `boot.ts` → `desktop`），**不覆盖**已存在的值；未知则不注入该段。真源 `packages/workspace/src/workspace-anchor.ts`（`resolveRuntimeSurface` / `formatRuntimeSurfaceAnchor`）。`tui` **不**声明：它 attach 到已运行的 Host，形态跟随 Host。

## 养 AI 放哪

| 目的 | 放哪 |
|------|------|
| 跨项目默认偏好（产品种子） | `~/.xrk/AGENTS.md` · `SOUL.md`（`xrkh web` 写入；fingerprint 刷新；全席可见） |
| 本仓人格 / 语气（可选） | **`{workspace}/.xrk/SOUL.md` · `IDENTITY.md`**（推荐）；业界 `.agents/` **不**注入 SOUL |
| 跨项目约定草稿 | `~/.agents/AGENTS.md` · `rules/` · `context/`（父席；干员/子代理跳过） |
| 跨项目「用户是谁」事实 | **策展** `{XRK_HOME}/memories/USER.md`（`memory` 工具；**不是**站立 `~/.xrk/USER.md`） |
| 站立可选 `USER.md` | 仅人格草稿 inject；与策展 `memories/USER.md` 分文件，勿混写 |
| 跨项目 skill | **`{XRK_HOME}/skills/<name>/`**（入 catalog / `skill` / `skill.list`；勿与产品种子同名）；或 `~/.agents/skills/`（默认不进 catalog，需 `includeUserHomeSkills`） |
| 单项目规则（含 Cursor 格式） | `{workspace}/.cursor/rules/*.mdc`（**不是** `~/.cursor/rules`） |
| 单项目插件开发 / 架构 | 仓库内 `.agents/AGENTS.md` · `.agents/context/` · `.agents/skills/`（**只写增量**；勿抄 `apps/cli/seeds/`） |
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
  surface: "web", // 可省略 → 读 XRK_SURFACE；仍无则不注入该段
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

Turn-scoped / recomputable ephemeral context uses **[context-fragments](./context-fragments.md)** (`additional_context` · recap · …), layered **apart** from this inject path — do not fold it into skill-catalog / agent-instructions.

## Two-layer model

**User home = global persona**; **workspace = project overlay**.

| Layer | Paths | Priority |
|-------|-------|----------|
| **Global** | `~/.codex/` · `~/.claude/` · `~/.agents/` · `~/.xrk/` | Low |
| **Workspace** | Same vendor paths under `{workspace}/` + `.xrk/` | High |

Sections append in order; duplicate bodies dedupe; **later sections are closer to the turn**. Skill catalog follows the same rule: home is lower priority than project trees. Each rendered section carries a `> source: <path>` provenance line.

**Audience**: gates **manager ledger `XRK.md` only** (`audience=user`; not 干员家 / delegated children). Product standing, home convention (`~/.agents` · `~/.claude` · `~/.codex`), workspace convention, and skill catalog are the **same for every audience**. Badge and permission control the **tool runtime surface only**, not context. Progressive disclosure = catalog names → `skill` loads bodies — not thinner convention inject. Authority lanes: `<instruction_authority>` (`createInstructionAuthorityRegistry`; plugins may `register`).

**Source of truth**: `packages/workspace/src/inject-sources.ts` (`HOME_CONVENTION_INJECT` · `WORKSPACE_CONVENTION_INJECT` · skill root lists) · `ecosystem-instructions.ts` · `workspace-anchor.ts`.

## Inject policy (Codex-aligned)

Same core principle as Codex: **narrow instructions, progressive skill disclosure** (catalog = name+blurb → `skill` loads body; **no** `skill_search` — `tool_search` is for deferred tools only). Catalog truncate head: **公文包** (干员 / their children) → **workspace + seed `xrk-*`** → other globals; briefcase wins name clashes.

| Kind | Global `~/…` | Workspace `{root}/…` |
|------|--------------|----------------------|
| **Product standing** | **`~/.xrk/`** (AGENTS/SOUL/USER/IDENTITY/TOOLS …; every audience) | Same shape under `{workspace}/.xrk/` |
| **Convention instructions** | `.codex/AGENTS.md` · `.claude/*` · `.agents` AGENTS/rules/context (**every audience**) | **All present vendors attempted** (multi-agent same workspace): `.codex/` · `CODEX.md` · `.claude/` · `.agents/` · `.cursor/rules/**` · `.github/*` · root `AGENTS.md`/`CLAUDE.md` **alongside** `.xrk/` (content-deduped; per-file `xrk-inject: false` skips) |
| **Manager ledger `XRK.md`** | **`~/.xrk/XRK.md`** (standing seed · fingerprint, same as AGENTS; `audience=user` only) · legacy **`~/XRK.md`** | **`{workspace}/.xrk/XRK.md`** (same overlay shape as AGENTS) · legacy root **`XRK.md`**; not 干员家 / delegated children |
| **`~/.cursor/**`** | **Never injected** (Cursor IDE maintainer tree) | — |
| **`{root}/.cursor/rules/**`** | — | **Injected** (per-file opt-out via `xrk-inject: false`) |
| **Skill catalog / `skill` tool / `skill.list` / `/skills`** | **Always includes** `{XRK_HOME}/skills` (seeds + installs); other `~/…/skills` off by default | Shared roots; **truncate/display head**: briefcase → workspace+`xrk-*` → globals. Briefcase wins clashes. No `skill_search` |

Put cross-project persona under **`~/.xrk/`** (or workspace `.xrk/`); industry convention under **`~/.agents/`** (AGENTS/rules/context/skills). Not **`~/.cursor/`**.

## Product dir

assistant / context / rules / recipes default to `{workspaceRoot}/.xrk` (**no forced mkdir**).

**Skills do not require that directory.** Inject / `skill` / `skill.list` import existing skill trees automatically; missing dirs are skipped.

Workspace convention vendors are **additive when present** (not mutually exclusive): `.agents/` · `.claude/` · `.cursor/rules/` · `.codex/` · `CODEX.md` · `.github/` · root `AGENTS.md`/`CLAUDE.md` · `.xrk/` standing — so Cursor / Claude / Codex / product Agents can share one repo. Content-deduped; keep one handbook copy; maintainer notes use `xrk-inject: false`. Home `~/.cursor/**` is still never injected (IDE maintainer tree). Layering: [skills-layers.md](./skills-layers.md).

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

1. **Product standing** `~/.xrk/` AGENTS/SOUL/… (every audience; `includeUserHome` default on)
2. **Home convention** (`HOME_CONVENTION_INJECT`; **every audience**): `~/.codex/AGENTS.md` · `~/.claude/*` · `~/.agents` AGENTS/rules/context
3. **Manager ledger** (`audience=user` only): standing `~/.xrk/XRK.md` (+ legacy `~/XRK.md`)
4. **Workspace convention** (`WORKSPACE_CONVENTION_INJECT`; **all present**): `.codex/AGENTS.md` · `CODEX.md` · `.claude/CLAUDE.md`+`rules/` · `.agents` AGENTS/rules/context · `.cursor/rules/**` · `.github/*`
5. `{workspace}/.xrk/`: `SOUL.md` · `USER.md` · `IDENTITY.md` · `TOOLS.md` · `AGENTS.md` · `assistant.md` · `context/*` · `rules.md` · `subagents.md`; plus **`XRK.md`** (user only)
6. Workspace-root `AGENTS.md` (always attempted; `xrk-inject: false` skips); legacy root `XRK.md` (user only, earlier with ledger)
7. Workspace-root `CLAUDE.md` (skipped when it is only a single `@AGENTS.md` line)
8. Skills → separate catalog inject (see table; product-home `{XRK_HOME}/skills` always listed)

Anchor block (`resolveWorkspaceInject`): `## Workspace root` → optional `## Product home` (absolute path) → optional `## Runtime surface` → optional `## Session policy`.

## Where to put persona

| Goal | Location |
|------|----------|
| Cross-project defaults (product seed) | `~/.xrk/AGENTS.md` · `SOUL.md` (`xrkh web`; fingerprint refresh; every audience) |
| Workspace persona / tone (optional) | **`{workspace}/.xrk/SOUL.md` · `IDENTITY.md`** (preferred); industry `.agents/` does **not** inject SOUL |
| Cross-project convention drafts | `~/.agents/AGENTS.md` · `rules/` · `context/` (parents; skipped for 干员/subagents) |
| Cross-project “who the user is” facts | **Curated** `{XRK_HOME}/memories/USER.md` (`memory` tool; **not** standing `~/.xrk/USER.md`) |
| Standing optional `USER.md` | Persona-draft inject only; separate file from curated `memories/USER.md` |
| Cross-project skill | **`{XRK_HOME}/skills/<name>/`** (catalog / `skill` / `skill.list`; avoid seed names); or `~/.agents/skills/` (off catalog unless `includeUserHomeSkills`) |
| Project rules (including Cursor format) | `{workspace}/.cursor/rules/*.mdc` (**not** `~/.cursor/rules`) |
| Single-project plugin / architecture | In-repo `.agents/AGENTS.md` · `.agents/context/` · `.agents/skills/` (**overlay only**; do not copy `apps/cli/seeds/`) |
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
