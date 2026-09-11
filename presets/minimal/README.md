# presets/minimal

Composition only: fs tools (`read_file` · `write_file` · `apply_edit` · glob/grep) · skill · write-intent · workspace inject · replay LLM. **No** bash / PTY.

SDK / CLI `run` defaults here. For local shell, use the **shell** session badge (harness plane), not a shell-only redefinition of this preset — see `docs/profiles.md`.

`workspaceInject` / `slashRecipes` default on with assemble (`slashRecipes: false` still expands `/skill-name`) — see `docs/workspace-inject.md`, `docs/slash-recipes.md`.
