# @xrkseek/workspace

Product workspace inject, seed sync, recipes, and tool-output persist.

## Inject

`createWorkspaceInjector` · `resolveWorkspaceInject` — see `docs/workspace-inject.md`.

Order: assistant → context → rules → skills cards → subagents.  
Default product dir: `{root}/.xrk` (never repo-root `AGENTS.md`).

Presets (`minimal` / `harness`) wire inject into three-layer `workspaceBlocks` by default.

## Tool output persist

`createWorkspaceToolOutputPersist({ root })` writes full truncated tool bodies under
`.xrk/tool-outputs/` for `boundToolOutput` markers.

See `docs/tool-output-bound.md`.

## Recipes / slash

`parseRecipeYaml` / `applyRecipe` / `loadOfficeRecipes` / `tryApplySlashRecipe` — see `docs/slash-recipes.md`.

Presets wire `{productDir}/recipes` into `assemble.resolveSlash` by default.
