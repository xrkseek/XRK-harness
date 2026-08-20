# Slash recipes and skills

> **读者**：终端用户 · 集成者。

Expand `/id ?` **before** `user/message` is logged. Recipe ids win when a skill has the same name.

Hot path: `assemble.resolveSlash` inside `runTurn` (`@xrkseek/core-agent-loop`).  
Parse/apply: `@xrkseek/workspace` (`createSlashResolver`, `tryApplySlashRecipe`, `tryApplySlashSkill`, `loadOfficeRecipes`).

## Behavior

1. Text starts with `/id` and `id` matches a loaded recipe ? expand prompt + optional instructions.
2. Else `id` matches an imported multi-root skill (e.g. `.claude/skills/<id>/SKILL.md`) ? prepend `<skill_content>` to the user prompt (`systemExtra` empty so it is not wrapped as `## Recipe`). Remainder after `/id` is kept after the body.
3. One required recipe param ? entire rest is that value; else `key=value` / `key: value` pairs.
4. Unknown `/id` ? leave raw text (no expand).
5. Logged user content is the **expanded** prompt (model-visible ? session).

Recipe instructions land as a `## Recipe` workspace block on the three-layer system string. Skill bodies do **not** ? they are in the user event.

Skill slash is **not** a Face command: unknown `/name` on `session.prompt` is admitted as text, then expanded here. `commands/list` / `commands/execute` still only cover builtins, process plugins, and recipes.

## Presets

`minimal` / `harness` when `assemble !== false`:

| Option | Meaning |
|--------|---------|
| omit / `true` | load `{productDir}/recipes/*.yaml` (default productDir `{root}/.xrk`) plus skill slash |
| `false` | skip recipe load; skill slash still wired |
| `string` | load that recipes directory plus skill slash |

Seed example: `templates/office-agent/recipes/daily-standup.yaml` via `syncSeedsFrom` or copy into `.xrk/recipes`.

## Outbound pipeline

`createSlashRecipeStep(resolve)` for custom outbound chains. Default `slashRecipeStep` remains a no-op unless `createDefaultOutbound({ resolveSlash })` is passed ? prefer the hot-path `resolveSlash` on assemble.

See also: [workspace-inject.md](./workspace-inject.md), `templates/office-agent/README.md`.
