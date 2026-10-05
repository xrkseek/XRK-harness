# AGENTS.md — 产品工作区（写插件）

> **Host 注入**：本文件仅当**本仓作工作区**时注入，并**替代**根维护者 `AGENTS.md`。  
> 全局站立（语气、主线、presence、附件溯源、能力挂载）只在 **`~/.xrk/AGENTS.md`**（`apps/cli/seeds/standing/`）。**不要**在本文件复写那份正文。

## 角色

工作区根为 **XRK-Harness 源码仓** 时：写进程插件；改内核走 Cursor + 根 `AGENTS.md`。

## 读写边界

| | 可以 | 不可以 |
|--|------|--------|
| **写** | `extensions/<plugin-id>/` | 默认改 `packages/` · `apps/` · `presets/` · `docs/` |
| **读** | 全仓 `docs/` · `.agents/skills/` · `packages/`（只读学结构） | 把内核写回去；workspace 外写文件 |
| **装插件** | `xrkh plugin add` | 假装热重载 |

插件沙箱：**`extensions/<plugin-id>/`**。

产品默认 skill / recipes 在 **`~/.xrk/skills`** · **`~/.xrk/recipes`**（CLI seeds）。本目录 **`.agents/skills`** 只放本仓增量（架构、CodeGraph、发版链等），**不要**再抄一份 `xrk-delegate` / `xrk-plugin-author` 等同名剧本。需要那些流程时用 **`skill` 工具**加载家目录种子。

<!-- CODEGRAPH_START -->
## CodeGraph

本仓已建索引（`.codegraph/`）。**定位符号 / 摸清调用链 / 评估改动影响面时，先查 CodeGraph 再 grep+read**：
一次 `codegraph_explore "<问题或符号名>"` 就返回相关符号的逐行原文 + 调用链（含动态派发）+ 影响面；
`grep` 摸索在这个 3k 文件的仓里纯属浪费。

- MCP 工具 `codegraph_explore`（已挂 Host Settings）；CLI `codegraph explore / node / callers / impact / sync` 永远可用。
- 细则见 skill **`codegraph-retrieval`**。
- 索引缺失时才退回 grep/read；改完文件先 `codegraph sync` 再查。

<!-- CODEGRAPH_END -->

## 办事流程（本仓增量）

0. 检索 / 定位 → **`codegraph-retrieval`**
1. 结构 → **`xrk-harness-architecture`**
2. 写插件 → **`xrk-harness-monorepo`**（再 `skill` 加载家目录 **`xrk-plugin-author`** / **`xrk-plugin-verify`**）
3. 斜杠脚手架 → **`/plugin-scaffold`**

全局 Plan / 委派 / 主线 / Canvas / MCP 挂载：见家目录站立 `AGENTS.md` 与对应种子 skill。

细则：`.agents/context/` · `docs/plugin-development.md`
