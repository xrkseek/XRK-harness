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
Writes land in **system data** (`~/.xrk/host-settings.json`), not the project tree.

Harness monorepo workspace: unclear kind → **`xrk-plugin-kind`**; in-repo JS →
**`xrk-plugin-author`** then **`xrk-plugin-verify`**. Home seed truth:
`apps/cli/seeds/skills/xrk-capability-attach/` (copied on `xrkh web`).

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
| Public / npm MCP server | **This skill** (default) |
| In-repo JS tools | **`xrk-plugin-author`** + restart |

### 2. Collect

- stdio (`command` + `args`, optional `cwd`) or HTTP (`url`)
- Server id; connect now? (`allowConnect`)

### 3. Emit pasteable JSON

No `env`. Secrets → Credentials.

```json
{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest"]}}}
```

```json
{"mcpServers":{"remote":{"url":"https://example.com/mcp"}}}
```

### 4. Land (confirmation required)

**Preferred:** Settings → Plugins → Plugin config → Add from JSON → allow connect → **Save**.

**Only if** user authorizes mutate:

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

No mutate without confirmation. No `connected`/`parked` overlays. No `env` on servers.

### 5. Verify

Row connected / **park** / failed; inventory `mcp__<server>__…`; policy deny → park.

Slash: `/mcp-attach` (`.agents/recipes/mcp-attach.yaml`).

## Related

- `docs/modules/mcp.md` · `docs/host-face.md` · `docs/skills-layers.md`
- `xrk-create-skill` · `xrk-adapt-workspace`
