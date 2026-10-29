---
name: xrk-plugin-dev-care
description: >-
  Author a complete XRK process plugin without the harness monorepo: kind
  choice, scaffold, install, restart, verify. Use when the user wants a
  plugin, slash command, extra tools, or 「扩展能力」and may have no source tree.
---

# 插件开发（无源码）

Process plugin = `xrk.plugin.json` + entry. Host **restart** → tools. No harness repo needed.

## Pick kind

| Want | Choose |
|------|--------|
| Existing MCP server | Settings → MCP (`xrk-home-config`) — do not wrap |
| Local functions for the model | `kind: "tools"` |
| Extra system prompt | `kind: "prompt"` |
| Slash command | `kind: "commands"` |
| Product shell UI | Community / client — not this template |

## Place

1. `workspace_list` → **coding** workspace (not `ws_default`).
2. `extensions/<plugin-id>/` (or user path).
3. `workspace_session_prompt` to write files; keep `session_id`; pin 主线 (`xrk-mainline-sideline`).

## Minimal tools template

`xrk.plugin.json`:

```json
{ "id": "my-plugin", "kind": "tools", "entry": "./plugin.mjs" }
```

`plugin.mjs`:

```js
export function createPlugin() {
  return {
    id: "my-plugin",
    kind: "tools",
    tools: [{
      name: "my_ping",
      description: "Health check — returns pong. Use to verify the plugin loaded.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() { return { content: "pong" }; },
    }],
  };
}
```

Rules: `id`/`kind` match `createPlugin()`. Stable `name`; `description` says when to use and how failure looks — no empty text, no catch-all that swallows errors. Keys → Credentials only (never plugin source or skill).

- `prompt` → `promptSections` (not fake tools).
- `commands` → Face slash list. Same name as a user recipe → recipe wins; pick another name.

## Install

```bash
xrkh plugin add <abs-or-rel-path>
xrkh restart
xrkh plugin list
```

No hot reload — restart Host (or Desktop Host) after edits. Or `XRK_PLUGINS_DIR=<parent>`. Default list: `~/.xrk/plugins` (`XRK_HOME` / `XRK_PLUGINS_DIR` override).

## Verify

- [ ] id in `plugin list`
- [ ] **new session** sees tool name
- [ ] call once (`my_ping` → pong)
- [ ] still missing → badge/policy/wrong dir — not blind `--force`
- [ ] MCP issues → `xrk-home-config`, not restart loops

## Deliver

Path · add+restart done? · how to try · Credentials if needed.

## Anti

- Refuse without harness source.
- Drop plugins in Xiangyang cwd.
- Scaffold when MCP fits.
- Claim broken before restart.
