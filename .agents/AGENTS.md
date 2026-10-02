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

## 附件溯源（公开契约）

附件 id（`sha256:<hex>`）是**内容寻址**的：id 即字节 SHA-256，本身就是持久地址，落盘路径**可由 id 直接推导，禁止满盘搜索**：

- 图片原图：`{XRK_HOME}/attachments/v1/objects/<sha256 前 2 位>/<sha256>`
- 普通文件：`{XRK_HOME}/attachments/v1/files/<sha256 前 2 位>/<sha256>/<原始文件名>`
- 请求变体缓存（可重建，删了不碰原图）：`{XRK_HOME}/cache/attachments/request-images/`

溯源 / 再看：`read_image file_path=sha256:…` 或 `attachment:sha256:…`（工具内按 id 读回并重新入库）；`image_generate` 结果文本给 `attachmentId=sha256:…`，同样可 `read_image` 溯源。聊天记录里的图/文件引用（含 tool result）走同一套 id → 路径推导；UI 端经 Face `session.attachment` 按会话事件引用授权读取（仅本 session 引用过的 id），base64 展示。具体合同见 `docs/modules/attachment.md`。

<!-- CODEGRAPH_START -->
## CodeGraph

本仓已建索引（`.codegraph/`）。**定位符号 / 摸清调用链 / 评估改动影响面时，先查 CodeGraph 再 grep+read**：
一次 `codegraph_explore "<问题或符号名>"` 就返回相关符号的逐行原文 + 调用链（含动态派发）+ 影响面；
`grep` 摸索在这个 3k 文件的仓里纯属浪费。

- MCP 工具 `codegraph_explore`（已挂 Host Settings）；CLI `codegraph explore / node / callers / impact / sync` 永远可用。
- 细则见 skill **`codegraph-retrieval`**。
- 索引缺失时才退回 grep/read；改完文件先 `codegraph sync` 再查。

<!-- CODEGRAPH_END -->

## 办事流程

0. 检索 / 定位 → **`codegraph-retrieval`**（CodeGraph 图谱先于 grep+read）
1. 结构 → **`xrk-harness-architecture`**
2. 挂/改 MCP 或 Settings → **`xrk-capability-attach`**（全局工具）
3. 工作区 Canvas / 概况看板 → **`xrk-canvas`**（`canvas_*`；磁盘 `{XRK_HOME}/canvases/<workspaceId>/`）
3. 配模型 → **`xrk-models-settings`**
4. 先计划 → **`/plan`** · **`xrk-plan-build`** · `exit_plan_mode`
5. 委派 → **`xrk-delegate`**
6. 审 diff → **`xrk-code-review`**
7. 写插件 → **`xrk-harness-monorepo`** → **`xrk-plugin-author`**
8. 验证 → **`xrk-plugin-verify`**

细则：`.agents/context/` · `docs/plugin-development.md`
