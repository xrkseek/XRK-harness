---
name: xrk-adapt-workspace
description: >-
  Orient to a blank or unfamiliar workspace: read-only stack probe, optional
  standing files only with consent, then attach capabilities. Use when the user
  opens an empty folder, a new project, or asks 「空项目」「新工作区」
  「适应这个仓库」「这是什么项目」.
---

# Adapt workspace

Goal: be useful **without** littering a blank folder. Complexity in the project
tree stays **zero** unless the user asks for project-local files.

## Workflow

```
- [ ] 1. Read-only probe
- [ ] 2. Summarize stack (or “empty”)
- [ ] 3. Capabilities only if asked
- [ ] 4. Standing files / skills only with consent
```

### 1. Read-only probe

Look for: `package.json`, lockfiles, `Cargo.toml`, `go.mod`, `pyproject.toml`,
`README*`. Do **not** create `.xrk` / `.agents` “for convenience”.

### 2. Summarize

Tell the user what you found in one short paragraph. If empty: say the folder
can stay empty; product data lives under `~/.xrk`.

### 3. Capabilities (when asked)

| Ask | Skill / path |
|-----|----------------|
| Install MCP / external tools | **`xrk-capability-attach`** → Settings MCP → `~/.xrk/host-settings.json` |
| In-repo JS tools | Process plugin + restart |

Blank folder **does not** gain files from MCP attach.

### 4. Standing files / new skills (consent)

| Ask | Where |
|-----|--------|
| Global habit / skill | `~/.xrk/skills/` via **`xrk-create-skill`** |
| Project AGENTS / rules / skills | Workspace `.agents/` or `.xrk/` **only after explicit yes** |

Default: **do not create** workspace standing files.

## Hard rules

- No auto-`mkdir` of `.xrk` / `.agents` in the workspace
- Secrets → Credentials, never skill or AGENTS body
- Prefer MCP Settings over scaffolding plugins for third-party tools
