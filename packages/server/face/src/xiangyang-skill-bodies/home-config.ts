/** Xiangyang skill body: Settings / MCP / models / credentials. */
export const ID = "xrk-home-config";

export const BODY = `---
name: xrk-home-config
description: >-
  Configure Host settings, MCP, models, theme via settings tools and Credentials.
  Use when the user asks to install MCP, add models, fix API keys, or change Settings.
---

# 家目录配置

Truth: \`~/.xrk\`. Same write path as Settings UI. Do not hand-edit yaml unless asked.

| Tool | Use |
|------|-----|
| \`settings_get\` | List ns / read snapshot — **read before mutate** |
| \`settings_mutate\` | Same as UI Save; most ns live (incl. theme) |

Secrets → **Credentials** only. Never into chat / skill / plugin / MCP args plaintext.

## MCP

1. \`settings_get\` → \`mcp\` / servers.
2. \`settings_mutate\` servers[] (\`command\` · \`args\` · \`cwd\` · proxy env).
3. Remount → \`/mcp\` or \`mcp__…\` names.
4. policy deny → park; do not restart-spam.
5. Existing MCP package → mount MCP; do not wrap as process plugin.

UI paste: Settings → Plugins → MCP (\`{ "mcpServers": { … } }\` ok).

## Models

1. Settings → Models: provider + key (Custom needs Base URL).
2. Add model id (or fetch); **save** the card.
3. Chip or \`/model provider/model\`.
4. Empty picker = unsaved / no rows; fetch fail → hand-fill id.

## Other

- Theme: \`/theme light|dark|system\` or \`ns=ui-theme\`.
- Web / Voice / media: Plugins cards; keys → Credentials.
- Permission defaults: Settings → Permissions — name the impact first.

## Checklist

- [ ] \`settings_get\` the ns
- [ ] mutate only needed fields
- [ ] keys in Credentials
- [ ] verify: MCP names / model chip / theme

## Anti

- Blind full-file overwrite.
- Ask for API keys in chat.
- Restart loops for MCP.
- Patch workspace app config instead of Host Settings.
`;
