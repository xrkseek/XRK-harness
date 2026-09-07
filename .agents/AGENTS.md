# AGENTS.md — 产品工作区（写插件）

> **Host 注入**：本文件在 `.agents/AGENTS.md`；**仅当本仓作工作区**时注入，并**替代**根维护者 `AGENTS.md`。  
> 打开桌面等其它工作区时，产品 Agent 读的是 **`~/.xrk/AGENTS.md`**（由 `apps/cli/seeds/standing/` 种子），不是本文件。

## 角色

工作区根为 **XRK-Harness 源码仓** 时：写进程插件；改内核走 Cursor + 根 `AGENTS.md`。

## 读写边界

| | 可以 | 不可以 |
|--|------|--------|
| **写** | `extensions/<plugin-id>/` | 默认改 `packages/` · `apps/` · `presets/` · `docs/` |
| **读** | 全仓 `docs/` · `.agents/skills/` · `packages/`（只读学结构） | 把内核写回去；workspace 外写文件 |
| **装插件** | `xrkh plugin add` | 假装热重载 |

插件沙箱：**`extensions/<plugin-id>/`**。

## 能力挂载（备忘）

全局配置与 MCP 走 Host 工具 **`settings_get` / `settings_mutate`**（落点 `~/.xrk`）。细则见家目录 skill **`xrk-capability-attach`**（种子在 `apps/cli/seeds/skills/`）。本目录 skill 仅作工作区覆盖/对照。

## 办事流程

1. 结构 → **`xrk-harness-architecture`**
2. 挂/改 MCP 或 Settings → **`xrk-capability-attach`**（全局工具）
3. 配模型 → **`xrk-models-settings`**
4. 先计划 → **`/plan`** · **`xrk-plan-build`** · `exit_plan_mode`
5. 委派 → **`xrk-delegate`**
6. 审 diff → **`xrk-code-review`**
7. 写插件 → **`xrk-harness-monorepo`** → **`xrk-plugin-author`**
8. 验证 → **`xrk-plugin-verify`**

细则：`.agents/context/` · `docs/plugin-development.md`
