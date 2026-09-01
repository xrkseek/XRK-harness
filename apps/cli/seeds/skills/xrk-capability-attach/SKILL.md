---
name: xrk-capability-attach
description: >-
  挂 MCP / 接外部工具 / attach：Settings 粘贴 mcpServers、允许连接、用户确认后 mutate。
  用户说「装 MCP」「挂工具」「接服务器」「attach」「加工具」时使用。
---

# 能力挂载（MCP 优先）

本 skill 由 **XRK Harness CLI** 种子安装到 `~/.xrk/skills/`（用户目录，对标 Cursor 的 `~/.cursor/` 默认层）。工作区 `.agents/skills` 可覆盖同名。

轻便专业：默认走 **设置 → 插件 → 插件配置**；不堆 Cursor `hooks.json`。

## 步骤

1. **选型**  
   - 已有 / 可起 MCP → 本流程（默认）  
   - 项目内简单自有 JS → 进程插件 `kind: tools`（须 `plugin add` + restart）

2. **问清** — stdio（`command`+`args`）或 HTTP（`url`）；服务器 id；是否立刻 **允许连接**

3. **产出可粘贴 JSON**（禁 `env`；密钥 → Credentials）

```json
{"mcpServers":{"demo":{"command":"npx","args":["-y","demo-mcp"]}}}
```

4. **落地（须用户确认）**  
   - **推荐**：用户在 Settings 粘贴 → 允许连接 → **Save**  
   - **仅当用户明确授权「你来改设置」** 时再 `settings.mutate`：

```json
{
  "ns": "mcp",
  "ops": [
    {
      "op": "set",
      "path": ["servers"],
      "value": [{ "serverName": "demo", "command": "npx", "args": ["-y", "demo-mcp"] }]
    },
    { "op": "set", "path": ["allowConnect"], "value": true }
  ]
}
```

   未确认不得 mutate。勿写 `connected` overlay；勿在 servers 条目塞 `env`。

5. **校验** — 行状态 connected / park / 失败；工具名 `mcp__<server>__…`；policy deny → park。

## 相关

- 契约：产品文档 `docs/modules/mcp.md` · `docs/host-face.md`  
- 分层：`docs/skills-layers.md`
