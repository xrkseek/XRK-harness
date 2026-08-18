# @xrkseek/workspace

Product workspace inject, seed sync, recipes, skill load, and tool-output persist.

## Inject

`createWorkspaceInjector` · `resolveWorkspaceInject` — see `docs/workspace-inject.md`.

Order: assistant → context → rules → skills cards (`SKILL.md` name+description) → subagents.  
Full skill bodies are loaded by the `skill` tool (`createSkillTools`), not injected.
Default product dir: `{root}/.xrk` (never repo-root `AGENTS.md`).

Presets (`minimal` / `harness`) wire inject into three-layer `workspaceBlocks` by default.

## Tool output persist

`createWorkspaceToolOutputPersist({ root })` writes full truncated tool bodies under
`.xrk/tool-outputs/` for `boundToolOutput` markers.

See `docs/tool-output-bound.md`.

## Recipes / slash

`createSlashResolver` / `tryApplySlashRecipe` / `tryApplySlashSkill` / `loadOfficeRecipes` — see `docs/slash-recipes.md`.

Presets wire `{productDir}/recipes` and `/skill-name` into `assemble.resolveSlash` when assemble is on (`slashRecipes: false` skips recipes only).
