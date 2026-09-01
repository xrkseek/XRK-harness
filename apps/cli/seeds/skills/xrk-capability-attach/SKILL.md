---
name: xrk-capability-attach
description: >-
  Attach external tools via MCP in XRK-Harness Settings (paste mcpServers JSON,
  allow connect, confirm before mutate). Use when the user asks to install MCP,
  add tools, connect a server, attach Playwright/filesystem/browser MCP, or
  「装 MCP」「挂工具」「接服务器」「attach」「加工具」.
---

# Attach capability (MCP)

Default path for new tools: **Settings → Plugins → Plugin config**.
Do not invent Cursor hooks, workspace `.xrk` folders, or process plugins unless the user needs in-repo JS.

Writes land in **system data** (`~/.xrk/host-settings.json`), not the project tree.

## Workflow

```
- [ ] 1. Choose path (MCP vs process plugin)
- [ ] 2. Collect server id + stdio/HTTP details
- [ ] 3. Emit pasteable JSON (no env)
- [ ] 4. Land with user confirmation
- [ ] 5. Verify row status + tool inventory
```

### 1. Choose path

| Need | Do |
|------|-----|
| Public / npm MCP server (Playwright, filesystem, …) | **This skill** (default) |
| Small in-repo JS tools | Process plugin (`kind: tools`) + `plugin add` + **restart** |

### 2. Collect

- Transport: stdio (`command` + `args`, optional `cwd`) **or** HTTP (`url`)
- Server id (key under `mcpServers`)
- Connect now? (`allowConnect`)

### 3. Emit pasteable JSON

No `env` in servers. Secrets → **Credentials**.

Stdio:

```json
{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest"]}}}
```

HTTP:

```json
{"mcpServers":{"remote":{"url":"https://example.com/mcp"}}}
```

### 4. Land (confirmation required)

**Preferred:** guide the user — Settings → Plugins → Plugin config → “Add from JSON” → allow connect → **Save**.

**Only if** the user explicitly says to change settings / mutate for them:

```json
{
  "ns": "mcp",
  "ops": [
    {
      "op": "set",
      "path": ["servers"],
      "value": [{
        "serverName": "playwright",
        "command": "npx",
        "args": ["-y", "@playwright/mcp@latest"]
      }]
    },
    { "op": "set", "path": ["allowConnect"], "value": true }
  ]
}
```

Never mutate without confirmation. Never write `connected` / `parked` overlays. Never put `env` on server entries.

### 5. Verify

- Row: connected / **park** / failed
- Inventory shows `mcp__<server>__…`
- Policy deny → **park** (desired kept, process not spawned) — explain; do not pretend it connected

## Related

- Product docs: `docs/modules/mcp.md`, `docs/host-face.md`, `docs/skills-layers.md`
- Self-upgrade playbooks: `xrk-create-skill`, `xrk-adapt-workspace`
