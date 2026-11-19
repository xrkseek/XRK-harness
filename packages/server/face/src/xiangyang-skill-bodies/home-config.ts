/** Xiangyang skill: deep Host Settings — thin global seed is xrk-capability-attach. */
export const ID = "xrk-home-config";

export const BODY = `---
name: xrk-home-config
description: >-
  向阳深配：settings_* / Credentials 改 MCP·models·theme·browser·computer-use·agent-loop。
  薄全局 → xrk-capability-attach；模型 quirks → xrk-models-settings；Team → xrk-delegate。
---

# 家目录配置（向阳）

Truth: \`~/.xrk\` = Settings UI path. \`settings_get\` before mutate. Secrets → **Credentials** only.

| Here | Hand off |
|------|----------|
| MCP · models · theme · Permissions · Agent loop · Browser · Computer use · Voice/media | Thin seed \`xrk-capability-attach\` · models \`xrk-models-settings\` |
| | Team / homes → \`xrk-delegate\` · route → \`xrk-demand-translate\` · plugins → \`xrk-plugin-dev-care\` |

## Browser

\`settings_get\` → \`browser\` → \`mode=agent-browser\` · \`browserBinary=auto\`. Missing → \`agent-browser install\` or \`executablePath\`. Headed default; Cookie only covers automation session.

## Computer use

\`settings_get\` → \`computer-use\` → \`mode=agent-desktop\` (off=\`off\`). Windows: \`uia\` / \`background\` via Credentials. Web→browser; desktop apps→computer-use.

## MCP

1. \`settings_get\` → \`mcp\`
2. Shared → global \`servers[]\` / \`allowConnect\`
3. Project / 干员家 → \`scope=workspace\` + \`workspaceId\` (**never** private→global)
4. Verify on target seat: \`/mcp\` or \`mcp__…\`; deny → park. Usage rules → \`mcp_mount\` / \`xrk-tool-surfaces\` (MCP≠badge).

## Models

Settings → Models: provider+key → add id → **save** → chip or \`/model\`. Empty picker = unsaved. Quirks → \`xrk-models-settings\`.

## Other

Theme \`/theme\` or \`ns=ui-theme\` · Permissions: explain then mutate · Agent loop \`ns=agent-loop\` · Voice/media Plugins cards · nicknames \`ui-presence\` (no stacked old titles).

Anti: blind whole-table overwrite · ask API key in chat · restart-spam MCP · settings_mutate「建干员」→ Team.
`;
