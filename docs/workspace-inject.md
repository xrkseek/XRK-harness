# Workspace inject

Product context injection into the **three-layer** assemble path (`assemble.workspaceBlocks`).

## Product dir

Default: `{workspaceRoot}/.xrk`

Never injects the host repo’s root `AGENTS.md` (Coding Agent docs ≠ product seed).

## Order

1. `assistant.md` / `ASSISTANT.md`  
2. `context/*` (sorted)  
3. `rules.md` / `RULES.md`  
4. `skills/*/SKILL.md` 卡片（name + description；全文走 `skill` 工具）  
5. `subagents.md`

Budget: char cap (default 32k) → `workspace/budget-truncation` events on the inject result (not session events yet).

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
} from "@xrkseek/workspace";

const { blocks, events, seeded } = await resolveWorkspaceInject({
  root: workspaceRoot,
  // productDir?: string
  // maxChars?: number
  // syncSeedsFrom?: "path/to/templates/office-agent"
});
```

`syncSeeds` = 缺补不覆盖.

## Presets

`minimal` / `harness` default **on** when `assemble !== false`:

| Option | Meaning |
|--------|---------|
| omit / `true` | inject `{root}/.xrk` into `workspaceBlocks` |
| `false` | skip inject |
| `{ productDir, maxChars, syncSeedsFrom }` | tune |

Composition exposes `composition.workspace` (`WorkspaceInjector`) for manual sync/inject.

Slash: `{productDir}/recipes` plus `/skill-name` into the logged user prompt — see [slash-recipes.md](./slash-recipes.md). `slashRecipes: false` skips recipes only.

See also: [host-preset.md](./host-preset.md), `templates/office-agent/README.md`.
