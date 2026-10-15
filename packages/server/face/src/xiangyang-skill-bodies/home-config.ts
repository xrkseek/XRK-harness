/** Xiangyang skill body: Settings / MCP / models / credentials. */
export const ID = "xrk-home-config";

export const BODY = `---
name: xrk-home-config
description: >-
  Configure Host settings, MCP, models, theme via settings tools and Credentials.
  Use when the user asks to install MCP, add models, fix API keys, or change Settings.
---

# 家目录配置（Settings · MCP · 模型）

配置在 **\`~/.xrk\`**，与当前编码工作区无关。向阳会话可直接改。  
优先走与 Settings UI **同一写入路径**的工具，勿手改 yaml（除非用户明确要求）。

## 工具

| 工具 | 作用 |
|------|------|
| \`settings_get\` | 列 ns 或读当前快照——**先读再改** |
| \`settings_mutate\` | 与 UI Save 同路径；多数 ns live（含主题） |

密钥 → **Credentials**（设置里的凭据 / Face credentials），**永不**写进聊天、skill、插件源码、MCP args 明文。

## MCP

1. \`settings_get\` 看现有 \`mcp\` / servers。  
2. \`settings_mutate\` 增删改 \`servers[]\`（\`command\` · \`args\` · \`cwd\` · 代理 env 键如 \`HTTP_PROXY\`）。  
3. 等 remount；用 \`/mcp\` 或工具名 \`mcp__…\` 验证。  
4. policy deny → park，别硬刷 restart。  
5. 已有 MCP 包 → **挂 MCP**，不要再包一层进程插件（插件见 \`xrk-plugin-dev-care\`）。

也可提示用户：Settings → Plugins → MCP，可粘贴 Cursor 风格 \`{ "mcpServers": { … } }\`。

## 模型

1. Settings → Models：提供方 + 密钥（自定义要 Base URL）。  
2. 添加模型 ID（可「获取可用模型」）；**必须保存**卡片。  
3. 对话芯片或 \`/model provider/model\` 选择。  
4. 选择器空 = 未保存或无模型行；fetch 失败仍可手填 ID。

## 外观与其它

- 主题：\`/theme light|dark|system\` 或 \`ns=ui-theme\`。  
- Web search / Voice / 图像·视频等：Plugins 对应卡；密钥走 Credentials。  
- 权限默认档：Settings → Permissions（含自动审查等）——改前说明影响。

## 步骤清单

- [ ] \`settings_get\` 确认 ns  
- [ ] \`settings_mutate\` 只改需要的字段（勿整表盲覆盖）  
- [ ] 密钥进 Credentials  
- [ ] 验证：MCP 工具名 / 模型芯片 / 主题已变  

## 反模式

- 未 \`settings_get\` 就覆盖整份 settings。  
- 让用户把 API key 贴进对话。  
- MCP 连不上却只狂 \`xrkh restart\`。  
- 用改工作区业务配置代替 Host Settings。
`;
