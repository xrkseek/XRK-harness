# AGENTS.md — 产品工作区（写插件）

> **Host 注入**：本文件在 `.agents/AGENTS.md`；存在时**不**再注入仓库根维护者 `AGENTS.md`。  
> 对标 XRK-AGT：`agents/workspace/AGENTS.md`（办事助手）vs 根 `AGENTS.md`（改框架）。

## 角色

工作区根常为 **XRK-Harness 源码仓**：绝大多数使用者在此 **写进程插件**；仅维护者改 `packages/` · `apps/`。

## 读写边界

| | 可以 | 不可以 |
|--|------|--------|
| **写** | `extensions/<plugin-id>/` | 默认改 `packages/` · `apps/` · `presets/` · `docs/` |
| **读** | 全仓 `docs/` · `.agents/skills/` · `packages/`（只读学结构） | 把内核写回去；workspace 外写文件 |
| **装插件** | `xrkh plugin add` | 假装热重载 |

插件沙箱：**`extensions/<plugin-id>/`**。工作区根见 inject **Workspace root** 块，勿搜其它盘符。

## Capability attach（能力挂载）

默认把「给 Agent 新工具」当成 **挂载**，不是堆 rules / 假 hooks。

1. **MCP 优先** — 设置 → 插件 → 插件配置：粘贴 Trae/Cursor 风格 `mcpServers` JSON → 开「允许连接」→ Save（本进程 remount）。禁在 `mcp.servers` 写 `env`；密钥走 Credentials。
2. **进程插件次之** — 仅简单自有 JS：写 `extensions/<id>/` → `xrkh plugin add` → **`xrkh restart`**。禁止假装插件热重载。
3. **人格另层** — `IDENTITY.md` · `SOUL.md` · `TOOLS.md` 管语气与边界，不替代工具表。

用户说「装 MCP / 挂工具 / attach」→ skill **`xrk-capability-attach`**。  
**未经用户确认**不得 `settings.mutate` ns=`mcp` 或代跑 `plugin add` / restart。

## 办事流程

1. 不懂结构 → skill **`xrk-harness-architecture`**
2. 挂 MCP / 接外部工具 → **`xrk-capability-attach`**
3. 配模型 / API / 模型列表 → **`xrk-models-settings`**
4. 写进程插件 → **`xrk-harness-monorepo`** → **`xrk-plugin-author`**
5. 验证 → **`xrk-plugin-verify`**（MCP 则看 Settings 行状态 / 工具 inventory）

细则：`.agents/context/workspace-plugin-dev.md` · `docs/plugin-development.md` · `docs/modules/mcp.md`

## 常见任务 → skill

| 意图 | 先读 |
|------|------|
| 这仓库什么结构 | **xrk-harness-architecture** |
| 装 MCP / 挂工具 / attach | **xrk-capability-attach** |
| 写 skill / 自我升级 | **xrk-create-skill** |
| 配模型 / 模型列表 | **xrk-models-settings** |
| kind / 要不要起 MCP | **xrk-plugin-kind** |
| 写插件 / 脚手架 | **xrk-harness-monorepo** → **xrk-plugin-author** |
| 装好了吗 / git pull 后 | **xrk-plugin-verify** |
| 改 loader 内核 | 超出默认角色；需维护者 |
