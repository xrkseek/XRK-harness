# 斜杠配方与技能 / Slash Recipes and Skills

> **读者 / Audience**：终端用户 · 集成者 / End users · Integrators

在 `user/message` 入账**之前**展开 `/id`。若 skill 与 recipe 同名，recipe id 优先。

Expand `/id` **before** `user/message` is logged. Recipe ids win when a skill has the same name.

热路径：`assemble.resolveSlash` inside `runTurn`（`@xrkseek/core-agent-loop`）。  
解析/应用：`@xrkseek/workspace`（`createSlashResolver` · `tryApplySlashRecipe` · `tryApplySlashSkill` · `loadOfficeRecipes`）。

## 行为 / Behavior

1. 文本以 `/id` 开头且 `id` 匹配已加载 recipe → 展开 prompt + 可选 instructions。  
2. 否则 `id` 匹配已导入的多根 skill（如 `.claude/skills/<id>/SKILL.md`）→ 在用户 prompt 前追加 `<skill_content>`（`systemExtra` 为空，避免包成 `## Recipe`）。`/id` 后的余文保留在 body 后。  
3. 仅一个必填 recipe 参数 → 整段余文为该值；否则解析 `key=value` / `key: value`。  
4. 未知 `/id` → 保留原文（不展开）。  
5. 入账的用户内容是**展开后**的 prompt（模型可见 ≡ session）。

1. Text starts with `/id` and `id` matches a loaded recipe → expand prompt + optional instructions.  
2. Else `id` matches an imported multi-root skill → prepend `<skill_content>` to the user prompt.  
3. One required recipe param → entire remainder is that value; else `key=value` / `key: value` pairs.  
4. Unknown `/id` → leave raw text.  
5. Logged user content is the **expanded** prompt.

Recipe instructions 以 `## Recipe` workspace 块进入三层 system 字符串（`systemExtra`）。站立 workspace assistant/rules 与 skill catalog 是 durable `user/message` injects — 见 [workspace-inject.md](./workspace-inject.md)。Skill slash 正文留在用户事件中。

Skill slash **不是** Face 命令：`session.prompt` 上未知 `/name` 先按文本 admit，再在此展开。`commands/list` / `commands/execute` 仍只覆盖 builtins、进程插件与 recipes。

## Presets

`minimal` / `harness` 在 `assemble !== false` 时：

| 选项 / Option | 含义 / Meaning |
|--------|---------|
| omit / `true` | 加载 `{productDir}/recipes/*.yaml`（默认 productDir `{root}/.xrk`）并接线 skill slash |
| `false` | 跳过 recipe 加载；skill slash 仍接线 |
| `string` | 加载该 recipes 目录并接线 skill slash |

种子示例：`templates/office-agent/recipes/daily-standup.yaml`（经 `syncSeedsFrom` 或复制到 `.xrk/recipes`）。

## 出站管道 / Outbound pipeline

自定义出站链可用 `createSlashRecipeStep(resolve)`。默认 `slashRecipeStep` 为 no-op，除非传入 `createDefaultOutbound({ resolveSlash })` — 优先使用 assemble 热路径上的 `resolveSlash`。

参见 / See also：[workspace-inject.md](./workspace-inject.md) · `templates/office-agent/README.md`。
