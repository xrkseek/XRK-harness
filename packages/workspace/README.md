# @xrkseek/workspace

Workspace product inject, skills, recipes, slash expand, tool-output persist.

`createWorkspaceInjector` · `resolveWorkspaceInject` · `appendWorkspaceInjectsIfChanged` — see `docs/workspace-inject.md`.

Presets (`minimal` / `harness`) append durable `user/message` injects (skill catalog + agent-instructions) at turn start by default. System persona stays separate for prompt-cache stability. `previewInject` still returns markdown `blocks`.
