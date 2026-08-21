# Workspace inject

> **读者**：集成者 · 贡献者。

Product context injection as **durable** `user/message` events (DSH-aligned), not into the three-layer **system** string. System keeps persona / plugin promptSections for prompt-cache stability.

## Product dir

Default for assistant / context / rules / recipes / seed sync: `{workspaceRoot}/.xrk`

**Not required for skills.** Inject / `skill` / `skill.list` auto-import existing skill trees; missing dirs are skipped (no mkdir).

Never injects the host repo’s root `AGENTS.md` (Coding Agent docs ≠ product seed). Layer map: [skills-layers.md](./skills-layers.md).

## Skills roots

Project (low → high priority; later wins on name clash):

| Path | Notes |
|------|--------|
| `.codex/skills/` | Codex compatibility |
| `.claude/skills/` | Claude Code |
| `.agents/skills/` | Vendor-neutral |
| `.cursor/skills/` | Cursor |
| `.xrk/skills/` | XRK-native overlay (wins) |

Also scans the same relative paths under the user home (`~/.claude/skills` … `~/.xrk/skills`) for the `skill` tool and Face `skill.list` (lower priority). Inject catalog uses **project roots only**. Nothing is created if absent.

## Durable inject (session log)

On each turn start (after `turn/start`, before the human `user/message`), presets call `appendWorkspaceInjectsIfChanged`:

| Payload | `user/message.source` | Model-facing body |
|---------|----------------------|-------------------|
| Skill catalog (name + description) | `skill-catalog` · `form: catalog` | `<available_skills>` … |
| assistant / context / rules / subagents | `agent-instructions` · `form: instructions` + `changes[]` | Markdown sections |

Digest last-wins: unchanged → no new row; changed → full replacement (`update: true` on catalog). Skill **bodies** still load via the `skill` tool or `/skill-name` (see [slash-recipes.md](./slash-recipes.md)).

Face chat renders non-`user` sources as collapsed **上下文注入** rows; Trajectory lists them by producer.

Budget: char cap (default 32k) → `source.budgetTruncations[]` on the durable inject (session-visible).

`workspace.previewInject` still returns markdown `blocks` (including skill cards) for UI preview only — those blocks are **not** copied into system.

## Order (instruction sections)

1. `assistant.md` / `ASSISTANT.md`  
2. `context/*` (sorted)  
3. `rules.md` / `RULES.md`  
4. Skills → separate catalog inject (not instruction markdown)  
5. `subagents.md`

## API

```ts
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  appendWorkspaceInjectsIfChanged,
  listSkillsFromWorkspace,
} from "@xrkseek/workspace";

const { blocks, durable, events, seeded } = await resolveWorkspaceInject({
  root: workspaceRoot,
  // productDir?: string
  // maxChars?: number
  // syncSeedsFrom?: "path/to/templates/office-agent"
});

// Turn boundary (presets):
await appendWorkspaceInjectsIfChanged({
  store,
  sessionId,
  turnId,
  now: Date.now,
  injectOptions: { root: workspaceRoot },
});
```

`syncSeeds` = 缺补不覆盖（显式调用才创建 `{productDir}`；日常 inject / skill 导入不强制建 `.xrk`）.

## Presets

`minimal` / `harness` default **on** when `assemble !== false`:

| Option | Meaning |
|--------|---------|
| omit / `true` | durable inject product dir + multi-root skill catalog at turn start |
| `false` | skip inject |
| `{ productDir, maxChars, syncSeedsFrom }` | tune product dir / seeds |

Composition exposes `composition.workspace` (`WorkspaceInjector`) for manual sync/inject.

Slash: `{productDir}/recipes` plus `/skill-name`（多根 skills）— see [slash-recipes.md](./slash-recipes.md). `slashRecipes: false` skips recipes only.

See also: [host-preset.md](./host-preset.md), `templates/office-agent/README.md`.
