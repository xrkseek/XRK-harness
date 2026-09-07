# 斜杠配方与技能

> **读者**：终端用户 · 集成者

在 `user/message` 入账**之前**展开 `/id`。若 skill 与 recipe 同名，recipe id 优先。

热路径：`assemble.resolveSlash` inside `runTurn`（`@xrkseek/core-agent-loop`）。  
解析/应用：`@xrkseek/workspace`（`createSlashResolver` · `tryApplySlashRecipe` · `tryApplySlashSkill` · `loadOfficeRecipes`）。

## 行为

1. 文本以 `/id` 开头且 `id` 匹配已加载 recipe → 展开 prompt + 可选 instructions。  
2. 否则 `id` 匹配已导入的多根 skill（如 `.claude/skills/<id>/SKILL.md`）→ 在用户 prompt 前追加 `<skill_content>`（`systemExtra` 为空，避免包成 `## Recipe`）。`/id` 后的余文保留在 body 后。  
3. 仅一个必填 recipe 参数 → 整段余文为该值；否则解析 `key=value` / `key: value`。  
4. 未知 `/id` → 保留原文（不展开）。  
5. 入账的用户内容是**展开后**的 prompt（模型可见 ≡ session）。

Recipe instructions 以 `## Recipe` workspace 块进入三层 system 字符串（`systemExtra`）。站立 workspace assistant/rules 与 skill catalog 是 durable `user/message` injects — 见 [workspace-inject.md](./workspace-inject.md)。Skill slash 正文留在用户事件中。

Skill slash **不是** Face 命令：未知 `/name` 与 **workspace recipe** 在 `session.prompt` 上均 **admit 为文本**，再由 assemble 展开。Face `commands/list` 仍可列出 recipes（标注 expands），但 `commands/execute` **不**执行 recipes——只执行 builtins（含 `/plan` · `/permission` · `/mcp` · `/compact` …）与进程 `kind: commands` 插件。

## Presets

`minimal` / `harness` 在 `assemble !== false` 时：

| 选项 | 含义 |
|--------|---------|
| omit / `true` | 加载 `{productDir}/recipes/*.yaml`（默认 productDir `{root}/.xrk`）并接线 skill slash |
| `false` | 跳过 recipe 加载；skill slash 仍接线 |
| `string` | 加载该 recipes 目录并接线 skill slash |

示例：`.agents/recipes/plugin-scaffold.yaml` 或 `{productDir}/recipes/*.yaml`。

## 出站管道

自定义出站链可用 `createSlashRecipeStep(resolve)`。默认 `slashRecipeStep` 为 no-op，除非传入 `createDefaultOutbound({ resolveSlash })` — 优先使用 assemble 热路径上的 `resolveSlash`。

参见：[workspace-inject.md](./workspace-inject.md) · [plugin-development.md](./plugin-development.md)。

---

# Slash Recipes and Skills

> **Audience**: End users · Integrators

Expand `/id` **before** `user/message` is logged. Recipe ids win when a skill has the same name.

Hot path: `assemble.resolveSlash` inside `runTurn` (`@xrkseek/core-agent-loop`).  
Resolve/apply: `@xrkseek/workspace` (`createSlashResolver` · `tryApplySlashRecipe` · `tryApplySlashSkill` · `loadOfficeRecipes`).

## Behavior

1. Text starts with `/id` and `id` matches a loaded recipe → expand prompt + optional instructions.  
2. Else `id` matches an imported multi-root skill (e.g. `.claude/skills/<id>/SKILL.md`) → prepend `<skill_content>` to the user prompt (`systemExtra` empty so it is not wrapped as `## Recipe`). Remainder after `/id` stays after the body.  
3. One required recipe param → entire remainder is that value; else parse `key=value` / `key: value`.  
4. Unknown `/id` → leave raw text.  
5. Logged user content is the **expanded** prompt (model-visible ≡ session).

Recipe instructions enter the three-layer system string as a `## Recipe` workspace block (`systemExtra`). Standing workspace assistant/rules and the skill catalog are durable `user/message` injects — see [workspace-inject.md](./workspace-inject.md). Skill slash body stays in the user event.

Skill slash is **not** a Face command: unknown `/name` **and workspace recipes** are **admitted as text** on `session.prompt`, then expanded here. Face `commands/list` may still list recipes (marked expands), but `commands/execute` does **not** run recipes — only builtins (`/plan` · `/permission` · `/mcp` · `/compact` …) and process `kind: commands` plugins.

## Presets

When `assemble !== false`, `minimal` / `harness`:

| Option | Meaning |
|--------|---------|
| omit / `true` | Load `{productDir}/recipes/*.yaml` (default productDir `{root}/.xrk`) and wire skill slash |
| `false` | Skip recipe load; skill slash still wired |
| `string` | Load that recipes directory and wire skill slash |

Examples: `.agents/recipes/plugin-scaffold.yaml` or `{productDir}/recipes/*.yaml`.

## Outbound pipeline

Custom outbound chains may use `createSlashRecipeStep(resolve)`. Default `slashRecipeStep` is a no-op unless `createDefaultOutbound({ resolveSlash })` is passed — prefer `resolveSlash` on the assemble hot path.

See also: [workspace-inject.md](./workspace-inject.md) · [plugin-development.md](./plugin-development.md).
