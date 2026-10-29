---
name: xrk-home-config
description: >-
  Configure Host settings, MCP, models, theme, permissions, agent-loop via
  settings tools and Credentials (same path as Settings UI). Use when the user
  asks to install MCP, add models, fix API keys, change Settings, or
  「改权限」「子代理并发」. Not for 干员/Team roster (→ xrk-delegate).
---

# 家目录配置

Truth: `~/.xrk`. **Same write path as Settings UI** — AI configures what humans click. Do not hand-edit yaml unless asked.

| Tool | Use |
|------|-----|
| `settings_get` | List ns / read snapshot — **read before mutate** |
| `settings_mutate` | Same as UI Save; most ns live (incl. theme) |

Secrets → **Credentials** only. Never into chat / skill / plugin / MCP args plaintext.

## Owns / handoff

| Here | Elsewhere |
|------|-----------|
| MCP · models · theme · Permissions · Agent loop · Web/Voice cards | Deep MCP edge cases → global `xrk-capability-attach` |
| | Model picker quirks → global `xrk-models-settings` |
| | **干员 / Team / 高级 pack** → `team_*` + `xrk-delegate` (not a settings ns) |
| | Process plugin authoring → `xrk-plugin-dev-care` |

## MCP

1. `settings_get` → `mcp` / servers.
2. `settings_mutate` servers[] (`command` · `args` · `cwd` · proxy env).
3. Remount → `/mcp` or `mcp__…` names.
4. policy deny → park; do not restart-spam.
5. Existing MCP package → mount MCP; do not wrap as process plugin.

UI paste: Settings → Plugins → MCP (`{ "mcpServers": { … } }` ok).

## Models

1. Settings → Models: provider + key (Custom needs Base URL).
2. Add model id (or fetch); **save** the card.
3. Chip or `/model provider/model`.
4. Empty picker = unsaved / no rows; fetch fail → hand-fill id.

## Other

- Theme: `/theme light|dark|system` or `ns=ui-theme`.
- Permissions: Settings → Permissions — name impact first, then mutate.
- Agent loop (depth / live children / model session cap): Settings → Plugins → Agent loop · `ns=agent-loop`.
- Web / Voice / media: Plugins cards; keys → Credentials.

## Checklist

- [ ] `settings_get` the ns
- [ ] mutate only needed fields
- [ ] keys in Credentials
- [ ] verify: MCP names / model chip / theme / Team still via `team_list` if relevant

## Anti

- Blind full-file overwrite.
- Ask for API keys in chat.
- Restart loops for MCP.
- Patch workspace app config instead of Host Settings.
- Use `settings_mutate` to "create 干员" — that is Team / `team_import`.
