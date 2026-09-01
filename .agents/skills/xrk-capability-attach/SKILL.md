---
name: xrk-capability-attach
description: >-
  挂 MCP / 接外部工具 / attach 能力：Settings 粘贴 mcpServers、允许连接、用户确认后 mutate。
  用户说「装 MCP」「挂工具」「接服务器」「attach」「加工具」时使用。
---

# 能力挂载（MCP 优先）

本 skill 真源在 CLI 包 `apps/cli/seeds/skills/xrk-capability-attach/`；用户可选装到 `~/.xrk/skills/`（`xrkh doctor --seed-skills` 或 `XRK_SEED_SKILLS=1`）。**默认不自动创建** `~/.xrk` / 工作区 `.xrk`。

轻便专业：默认走 **设置 → 插件 → 插件配置**，不堆 Cursor hooks，不假装插件热重载。

## 步骤

1. **选型**（不清时先 **`xrk-plugin-kind`**）  
   - 已有 / 可起 MCP 服务器 → 本 skill（默认）  
   - 仓库内简单自有 JS → **`xrk-plugin-author`**（须 restart）

2. **问清**  
   - stdio：`command` + `args`（及工作目录若需要）还是 HTTP：`url`  
   - 服务器 id（`mcpServers` 键名）  
   - 是否立刻 **允许连接**（`allowConnect`）

3. **产出可粘贴 JSON**（禁 `env`；密钥 → Credentials）

```json
{"mcpServers":{"demo":{"command":"npx","args":["-y","demo-mcp"]}}}
```

HTTP 例：`{"mcpServers":{"remote":{"url":"https://example.com/mcp"}}}`

4. **落地（须用户确认）**  
   - **推荐**：请用户打开设置 → 插件 → 插件配置 →「+ 从 JSON 添加」→ 勾选允许连接 → **Save**  
   - **仅当用户明确说「你来改设置 / mutate」**：

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

   未确认不得 mutate；勿写 `connected` overlay；servers 禁 `env`。

5. **校验**  
   - Settings 行状态：connected / park / 失败  
   - 工具 inventory 出现 `mcp__<server>__…`  
   - policy deny → 说明 **park**（desired 保留、未 spawn）；需放宽 policy 或关连接仅留草稿

6. 进程插件路径完成后走 **`xrk-plugin-verify`**（`plugin add` + restart）。

## 斜杠

`/mcp-attach` — 展开本流程模板（见 `.agents/recipes/mcp-attach.yaml`）。

## 相关

- 用户目录种子（可选）：`xrkh doctor --seed-skills` → `~/.xrk/skills/xrk-capability-attach`  
- 契约：[docs/modules/mcp.md](../../../docs/modules/mcp.md) · [docs/host-face.md](../../../docs/host-face.md)  
- 分层：[docs/skills-layers.md](../../../docs/skills-layers.md)
