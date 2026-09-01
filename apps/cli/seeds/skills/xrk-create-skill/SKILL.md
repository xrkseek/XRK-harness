---
name: xrk-create-skill
description: >-
  Author a new XRK-Harness product skill (SKILL.md under ~/.xrk/skills or a
  user-owned workspace skills tree). Use when the user asks to create a skill,
  teach the agent a workflow, self-upgrade, or 「写 skill」「create skill」
  「自我升级」「教 agent」.
---

# Create product skill

Teach a reusable workflow the agent can rediscover later. Prefer **home**
(`~/.xrk/skills`) for cross-workspace habits; use the **workspace** tree only
when the user wants project-local rules.

## Gather (before writing)

1. Purpose — one task the skill owns
2. Location — home vs workspace (ask if unclear)
3. Triggers — phrases the user will say (put them in `description`)
4. Steps / templates the model would not already know
5. Output shape — JSON, checklist, file layout

## Locations

| Scope | Path | Rule |
|-------|------|------|
| Home (default) | `~/.xrk/skills/<name>/SKILL.md` | Product may seed missing bundled skills on `xrkh web`; never overwrite an existing `SKILL.md` |
| Workspace | `{workspace}/.xrk/skills/` or `.agents/skills/` | **Only** if the user already has that tree or **explicitly** asks to create it |

Do **not** auto-`mkdir` `.xrk` / `.agents` in a blank folder. Sessions stay in system data.

## SKILL.md shape

```yaml
---
name: my-skill
description: >-
  Does X. Use when the user asks for Y, or says 「触发语」.
---
```

```markdown
# Short title

## Workflow
1. …
2. …

## Example
…
```

### Description rules (discovery)

- Third person; **WHAT** + **WHEN**; include trigger phrases
- Specific > vague (`Attach Playwright MCP` beats `Helps with tools`)
- Keep under ~1024 chars; `name` = directory name, kebab-case

### Body rules (tokens)

- Assume the agent is capable — only add product-specific facts
- Prefer short workflows + one concrete example
- Link docs by path; do not paste whole manuals
- One default path; one escape hatch (not a menu of five equals)

### Anti-patterns

- Diary / self-proof (“not Cursor”, “we are better than…”)
- Windows-only backslash paths in examples
- Secrets in the skill body
- Illegal boolean frontmatter (product **drops** the whole skill)

## After write

Ask the user to start a new turn or run `skill.list` so the skill is visible.
Home bundled seeds install on **`xrkh web`** (missing only).
