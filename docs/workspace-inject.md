# Workspace inject

> **读者**：集成者 · 贡献者。

Product context injection into the **three-layer** assemble path (`assemble.workspaceBlocks`).

## Product dir

Default for assistant / context / rules / recipes / seed sync: `{workspaceRoot}/.xrk`

**Not required for skills.** Inject / `skill` / `skill.list` auto-import existing skill trees; missing dirs are skipped (no mkdir).

Never injects the host repo’s root `AGENTS.md` (Coding Agent docs ≠ product seed).

## Skills roots

Project (low → high priority; later wins on name clash):

| Path | Notes |
|------|--------|
| `.codex/skills/` | Codex compatibility |
| `.claude/skills/` | Claude Code |
| `.agents/skills/` | Vendor-neutral |
| `.cursor/skills/` | Cursor |
| `.xrk/skills/` | XRK-native overlay (wins) |

Also scans the same relative paths under the user home (`~/.claude/skills` … `~/.xrk/skills`) for the `skill` tool and Face `skill.list` (lower priority). Inject catalog uses **project roots only** so the system budget is not flooded. Nothing is created if absent.

## Order

1. `assistant.md` / `ASSISTANT.md` (under product dir if present)  
2. `context/*` (sorted)  
3. `rules.md` / `RULES.md`  
4. Skills cards from the roots above（name + description；全文走 `skill` 工具）  
5. `subagents.md`

Budget: char cap (default 32k) → `workspace/budget-truncation` events on the inject result (not session events yet).

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  listSkillsFromWorkspace,
} from "@xrkseek/workspace";

const { blocks, events, seeded } = await resolveWorkspaceInject({
  root: workspaceRoot,
  // productDir?: string  — assistant/rules/recipes only
  // maxChars?: number
  // syncSeedsFrom?: "path/to/templates/office-agent"
});

const skills = await listSkillsFromWorkspace(workspaceRoot);
```

`syncSeeds` = 缺补不覆盖（显式调用才创建 `{productDir}`；日常 inject / skill 导入不强制建 `.xrk`）.

## Presets

`minimal` / `harness` default **on** when `assemble !== false`:

| Option | Meaning |
|--------|---------|
| omit / `true` | inject product dir + multi-root skills into `workspaceBlocks` |
| `false` | skip inject |
| `{ productDir, maxChars, syncSeedsFrom }` | tune product dir / seeds |

Composition exposes `composition.workspace` (`WorkspaceInjector`) for manual sync/inject.

Slash: `{productDir}/recipes` plus `/skill-name`（多根 skills）— see [slash-recipes.md](./slash-recipes.md). `slashRecipes: false` skips recipes only.

See also: [host-preset.md](./host-preset.md), `templates/office-agent/README.md`.
