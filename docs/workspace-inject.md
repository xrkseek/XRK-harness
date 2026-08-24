# 工作区注入 / Workspace Inject

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

产品上下文以**持久** `user/message` 事件注入（对齐稳定会话形态），**不**写入三层 **system** 字符串。System 保留 persona / plugin `promptSections`，以稳定 prompt cache。

Product context is injected as **durable** `user/message` events, not into the three-layer **system** string. System keeps persona / plugin `promptSections` for prompt-cache stability.

## 产品目录 / Product dir

assistant / context / rules / recipes / seed sync 默认：`{workspaceRoot}/.xrk`

**Skills 不强制该目录。** Inject / `skill` / `skill.list` 自动导入已有 skill 树；缺目录则跳过（不 mkdir）。

Never injects the host repo’s root `AGENTS.md` (Coding Agent docs ≠ product seed). Layer map: [skills-layers.md](./skills-layers.md).

## Skills 根 / Skills roots

项目内（低 → 高优先级；同名后列覆盖）：

| 路径 / Path | 说明 / Notes |
|------|--------|
| `.codex/skills/` | Codex 兼容 |
| `.claude/skills/` | Claude Code |
| `.agents/skills/` | 厂商中立 / Vendor-neutral |
| `.cursor/skills/` | Cursor |
| `.xrk/skills/` | XRK 原生叠加（优先） / XRK-native overlay (wins) |

用户主目录下同相对路径（`~/.claude/skills` … `~/.xrk/skills`）亦扫描，供 `skill` 工具与 Face `skill.list`（优先级更低）。Inject catalog **仅用项目根**。缺则不创建。

## 持久注入（会话日志） / Durable inject (session log)

每轮开始（`turn/start` 之后、人类 `user/message` 之前），presets 调用 `appendWorkspaceInjectsIfChanged`：

| 载荷 / Payload | `user/message.source` | 模型侧正文 / Model-facing body |
|---------|----------------------|-------------------|
| Skill catalog（name + description） | `skill-catalog` · `form: catalog` | `<available_skills>` … |
| assistant / context / rules / subagents | `agent-instructions` · `form: instructions` + `changes[]` | Markdown sections |

每条 inject（及人类 prompt）有唯一 `messageId`。Face wire `data.id` 使用该 id — **不是**裸 `turnId` — 以便同 turn 同时展示 inject 行与人类行而不挤掉对话。

Digest last-wins：未变 → 不新开行；已变 → 全量替换（catalog 上 `update: true`）。Skill **正文**仍经 `skill` 工具或 `/skill-name` 加载（见 [slash-recipes.md](./slash-recipes.md)）。

Face 聊天将非 `user` source 渲染为折叠的**上下文注入**行；Trajectory 按 producer 列出。

预算：字符上限（默认 32k）→ durable inject 上的 `source.budgetTruncations[]`（会话可见）。

`workspace.previewInject` 仍返回 markdown `blocks`（含 skill 卡片）仅供 UI 预览 — **不**拷进 system。

## 顺序（instruction 节） / Order (instruction sections)

1. `assistant.md` / `ASSISTANT.md`  
2. `context/*`（排序）  
3. `rules.md` / `RULES.md`  
4. Skills → 独立 catalog inject（不是 instruction markdown）  
5. `subagents.md`

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  appendWorkspaceInjectsIfChanged,
  listSkillsFromWorkspace,
} from "@xrkseek/workspace";

const { blocks, durable, events, seeded } = await resolveWorkspaceInject({
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

`syncSeeds` = 缺补不覆盖（显式调用才创建 `{productDir}`；日常 inject / skill 导入不强制建 `.xrk`）。

## Presets

`minimal` / `harness` 在 `assemble !== false` 时默认开启：

| 选项 / Option | 含义 / Meaning |
|--------|---------|
| omit / `true` | turn 开始时 durable inject + 多根 skill catalog |
| `false` | 跳过 inject |
| `{ productDir, maxChars, syncSeedsFrom }` | 调产品目录 / seeds |

Composition 暴露 `composition.workspace`（`WorkspaceInjector`）供手动 sync/inject。

斜杠：`{productDir}/recipes` 加 `/skill-name`（多根 skills）— 见 [slash-recipes.md](./slash-recipes.md)。`slashRecipes: false` 仅跳过 recipes。

参见 / See also：[host-preset.md](./host-preset.md) · `templates/office-agent/README.md`。
