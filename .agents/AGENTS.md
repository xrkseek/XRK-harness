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

## 办事流程

1. 不懂结构 → skill **`xrk-harness-architecture`**
2. 写插件 → **`xrk-harness-monorepo`** → **`xrk-plugin-author`**
3. 验证 → **`xrk-plugin-verify`**

细则：`.agents/context/workspace-plugin-dev.md` · `docs/plugin-development.md`

## 常见任务 → skill

| 意图 | 先读 |
|------|------|
| 这仓库什么结构 | **xrk-harness-architecture** |
| 写插件 / 脚手架 | **xrk-harness-monorepo** → **xrk-plugin-author** |
| kind / MCP 选型 | **xrk-plugin-kind** |
| 装好了吗 / git pull 后 | **xrk-plugin-verify** |
| 改 loader 内核 | 超出默认角色；需维护者 |
