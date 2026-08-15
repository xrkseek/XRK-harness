# Slash recipes

Expand `/recipe-id …` into model-visible user text + optional recipe instructions **before** `user/message` is logged.

Hot path: `assemble.resolveSlash` inside `runTurn` (`@xrkseek/core-agent-loop`).  
Recipe parse/apply: `@xrkseek/workspace` (`tryApplySlashRecipe`, `loadOfficeRecipes`).

## Behavior

1. Text starts with `/id` and `id` matches a loaded recipe → expand.
2. One required param → entire rest is that value; else `key=value` / `key: value` pairs.
3. Unknown `/id` → leave raw text (no expand).
4. Logged user content is the **expanded** prompt (model-visible ≡ session).

Recipe instructions land as a `## Recipe` workspace block on the three-layer system string.

## Presets

`minimal` / `harness` when `assemble !== false` and `slashRecipes !== false`:

| Option | Meaning |
|--------|---------|
| omit / `true` | load `{productDir}/recipes/*.yaml` (default productDir `{root}/.xrk`) |
| `false` | skip slash wire |
| `string` | load that directory |

Seed example: `templates/office-agent/recipes/daily-standup.yaml` via `syncSeedsFrom` or copy into `.xrk/recipes`.

## Outbound pipeline

`createSlashRecipeStep(resolve)` for custom outbound chains. Default `slashRecipeStep` remains a no-op unless `createDefaultOutbound({ resolveSlash })` is passed — prefer the hot-path `resolveSlash` on assemble.

See also: [workspace-inject.md](./workspace-inject.md), `templates/office-agent/README.md`.
