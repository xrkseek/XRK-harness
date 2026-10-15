/** Xiangyang skill body: full process-plugin authoring without harness source. */
export const ID = "xrk-plugin-dev-care";

export const BODY = `---
name: xrk-plugin-dev-care
description: >-
  Author a complete XRK process plugin without the harness monorepo: kind
  choice, scaffold, install, restart, verify. Use when the user wants a
  plugin, slash command, extra tools, or 「扩展能力」and may have no source tree.
---

# 插件开发（无源码仓也能完成）

进程插件 = 本机目录里的 \`xrk.plugin.json\` + 入口模块。Host **restart** 后进工具面。  
**不需要** XRK-harness 仓库；本 skill 含最小可运行模板。

## 0. 先选型（别一上来脚手架）

| 用户要什么 | 选 | 说明 |
|------------|-----|------|
| 接已有 / 可起的 MCP 服务器 | **Settings → MCP** | 走 \`xrk-home-config\`；不要再包一层 tools 插件 |
| 本机自有函数给模型调 | \`kind: "tools"\` | 本 skill |
| 追加一段 system 提示 | \`kind: "prompt"\` | 本 skill |
| 斜杠命令 | \`kind: "commands"\` | 本 skill |
| 改产品壳 UI | 社区 / client 包 | 不是 process tools；勿用本模板冒充 |

## 1. 落盘位置

1. \`workspace_list\` → 选用户**编码工作区**（不是向阳 \`ws_default\`）。
2. 在该工作区建 \`extensions/<plugin-id>/\`（推荐），或任意用户指定目录。
3. 用 \`workspace_session_prompt\` 派编码会话写文件；向阳侧保留 \`session_id\`，钉主线（见 \`xrk-mainline-sideline\`）。

## 2. 最小可运行模板（tools）

\`extensions/my-plugin/xrk.plugin.json\`：

\`\`\`json
{
  "id": "my-plugin",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
\`\`\`

\`extensions/my-plugin/plugin.mjs\`：

\`\`\`js
export function createPlugin() {
  return {
    id: "my-plugin",
    kind: "tools",
    tools: [
      {
        name: "my_ping",
        description: "Health check — returns pong. Use to verify the plugin loaded.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return { content: "pong" };
        },
      },
    ],
  };
}
\`\`\`

规则：

- \`xrk.plugin.json\` 的 \`id\` / \`kind\` 与 \`createPlugin()\` 返回值**一致**。
- 工具 \`name\` 稳定、\`description\` 写清何时用与失败语义；勿空描述、勿万能 catch 吞错。
- **密钥走 Credentials**（设置 UI / 凭据工具），禁止写进插件源码或 skill。

### prompt / commands 要点

- \`prompt\`：返回 \`promptSections\`（追加 system 段），不要假装成 tools。
- \`commands\`：提供 Face 可列出的斜杠；与用户 recipe 同名时 recipe 优先——起名避开冲突。

## 3. 安装与重载

\`\`\`bash
xrkh plugin add <插件目录的绝对或相对路径>
xrkh restart
xrkh plugin list
\`\`\`

- 进程插件**无热重载**；改完必须 \`restart\`（或重启 Desktop Host）。
- 也可用 \`XRK_PLUGINS_DIR=<父目录>\` 指向含多个插件的父文件夹再起 Host。
- 插件清单默认在 \`~/.xrk/plugins\`（可用 \`XRK_HOME\` / \`XRK_PLUGINS_DIR\` 改）。

## 4. 验证清单

- [ ] \`plugin list\` 出现该 id  
- [ ] **新开会话**（或重建 agent）后工具名可见  
- [ ] 调用一次（如 \`my_ping\` → pong）  
- [ ] 仍没有 → 查徽章/policy deny、是否装错目录；勿盲 \`--force\` 循环  
- [ ] MCP 问题勿按进程插件狂 restart → \`xrk-home-config\`

## 5. 交付话术（给零基础用户）

1. 插件目录在哪  
2. 已执行 \`plugin add\` + \`restart\` 与否  
3. 如何在新会话里试用工具名  
4. 密钥是否在 Credentials（若涉及）

## 反模式

- 没有 harness 源码就拒绝写插件。  
- 在向阳 cwd 里堆业务插件（应落到用户编码工作区）。  
- 一律脚手架、从不考虑 MCP。  
- 改完不 restart 就说「坏了」。
`;
