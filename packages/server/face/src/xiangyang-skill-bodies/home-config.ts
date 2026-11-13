/** Xiangyang skill body: Settings / MCP / models / credentials / browser. */
export const ID = "xrk-home-config";

export const BODY = `---
name: xrk-home-config
description: >-
  Configure Host settings, MCP, models, theme, permissions, browser, computer
  use via settings tools and Credentials (same path as Settings UI). Use when
  the user asks to install MCP, add models, fix API keys, change Settings,
  「改权限」「装浏览器」「开桌面操控」「子代理并发」. Not for 干员/Team roster
  (→ xrk-delegate).
---

# 家目录配置

Truth: \`~/.xrk\`. **Same write path as Settings UI** — you configure what humans click. Do not hand-edit yaml unless asked.

| Tool | Use |
|------|-----|
| \`settings_get\` | List ns / read snapshot — **read before mutate** |
| \`settings_mutate\` | Same as UI Save; most ns live (incl. theme) |

Secrets → **Credentials** only. Never into chat / skill / plugin / MCP args plaintext.

## Owns / handoff

| Here | Elsewhere |
|------|-----------|
| MCP · models · theme · Permissions · Agent loop · Browser · Computer use · Web/Voice | Thin global seed → \`xrk-capability-attach\` |
| | Model picker quirks → \`xrk-models-settings\` |
| | **干员 / Team / 高级 pack** → \`team_*\` + \`xrk-delegate\` |
| | Process plugin authoring → \`xrk-plugin-dev-care\` |

## Browser（网页）

打开网页 / 点元素 / 截图。默认本机 Chrome，一般不用下载。

1. \`settings_get\` → \`browser\`
2. \`mode=agent-browser\` · \`browserBinary=auto\`（Chrome → 缓存 Chromium → Edge）
3. 找不到：本机 \`agent-browser install\`（可走系统代理），或 \`executablePath\` → chrome/msedge
4. 窗口：\`headed=true\`（默认）/ \`false\` 后台；CDP 填调试地址；Cookie 只覆盖自动化会话

「能不能上网 / 装浏览器」→ 先查 browser 卡，再按需 install；勿叫用户改 yaml。

## Computer use（桌面）

操作本机桌面应用（窗口 / 点击 / 输入）。

1. \`settings_get\` → \`computer-use\`
2. 开：\`mode=agent-desktop\`；关：\`mode=off\`
3. Windows 备选：\`uia\` / \`background\`（助手路径在 Credentials）

网页走 browser；桌面应用走 computer-use。「点桌面上的…」→ 开 computer-use。

## MCP

Config seat: **here**. Live mount = 各席 \`mcp_mount\`（勿在此复述旅行规则）。

1. \`settings_get\` → \`mcp\`
2. Shared → mutate global \`servers[]\` / \`allowConnect\`（仅代理 env 键）
3. Project / **干员家** → \`scope=workspace\` + \`workspaceId\`（私用 → home id，**永不**全局）
4. 目标席验证：\`/mcp\` 或 \`mcp__…\`；deny → park

UI: Settings → Plugins → MCP

## Models

1. Settings → Models：provider + key（Custom 要 Base URL）
2. 加 model id（或 fetch）→ **save**
3. Chip 或 \`/model provider/model\`
4. 空 picker = 未保存 / 无行；fetch 失败 → 手填 id

## Other

- Theme: \`/theme light|dark|system\` 或 \`ns=ui-theme\`
- Permissions: 先说清影响再 mutate
- Agent loop: Settings → Plugins → Agent loop · \`ns=agent-loop\`
- Web / Voice / media: Plugins 卡；钥 → Credentials
- 表情球：\`ui-presence\`；改称呼后概况只留当前词，勿叠旧名

## Checklist

- [ ] \`settings_get\` 目标 ns
- [ ] 只 mutate 需要的字段
- [ ] 钥在 Credentials
- [ ] browser Auto 可用或 install 一次；桌面点击则开 computer-use
- [ ] 验证：MCP 名 / model chip / theme；Team 用 \`team_list\`

## Anti

- 盲整表覆盖
- 聊天里要 API key
- MCP 失败狂 restart
- 改工作区业务配置冒充 Host Settings
- 用 \`settings_mutate\`「建干员」→ Team / \`team_import\`
- 把 browser / computer-use 讲成「防御性拆分」——需要哪张卡开哪张
`;
