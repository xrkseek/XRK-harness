# Subagents（本仓产品工作区）

对标 DSH 委派习惯 + Codex review/plan：子代理是**独立会话**，不是免费线程。

## 默认

- 小改自己做；独立调研 / 范围清晰的实现片 / 只读 review 再用 `subagent`。
- `prompt` 必须自包含（子看不到父 transcript）。
- 默认同步等待；长任务才 `run_in_background` + `send_message` / `interrupt_agent`。
- **Frugal** 徽章无子代理工具；省钱就选它或少 spawn。**Shallow** 仅一层。

## 角色工具面（派活前必读 `child_gap`）

子代理的工具面由**角色**决定，比父会话窄。turn-start `<session_capability>` 里的
`child_gap` 会列出该角色 `omitted` 什么 —— **不核对就派活 = 让它空转**。

实测踩过的坑：`researcher`（含 catalog 里的 `mem_seed_researcher` 调研员）是
`web,read-fs` 面，**`omitted` 含 `bash` 与 `write_file`**。于是：

| 让它干 | 结果 |
|--------|------|
| 跑 `git diff` / `git log` 摸增量 | 没有 shell，只能瞎猜或反复重试 |
| 把长报告 `write_file` 落盘 | 没有写盘工具，结论只能全挤在对话正文 |

**判据**：任务需要 shell 或要产出文件 → 用 `worker` 面
（`mem_seed_worker` / `mem_seed_fixer` / `mem_seed_tester`）；
只读源码 + 搜网 + 回一段结论 → `researcher` 才对。
**取证类（要 git、要落盘）默认别派 `researcher`。**

## 并发与限流

免费路由（`free/kilo-auto/free`）**极易 429**。曾有三个并发调研员各自卡在
`model-retry attempt 18/20 of 30` + 60s 退避，烧掉 27–60 步仍未产出。

- 取证 / 对照类任务**并发 ≤2**；
- 本仓 `git grep` 往往比子代理冷启动**更快更准** —— 范围明确的核查自己做；
- 子代理报 `RATE_LIMIT` 且步数在涨而结论不涨，直接 `close_agent` 接手，别等。

## 输出落盘（长结论）

`subagent` / `wait_agent` 返回前，face 会把超过 **12k 字节**的输出 spill 到
`~/.xrk/spill/tool-outputs/`（约中文 4k 字）。工具正文里的 `notice` 会带路径，
但**模型经常无视 notice 里的路径**——所以 `tool` description 与返回正文里都要硬写
一句 `MUST read_file <path>`，不能只靠 notice。

## 剧本

| 意图 | Skill |
|------|--------|
| 何时委派 / 封顶 | **`xrk-delegate`** |
| Plan → Build | **`xrk-plan-build`** |
| 只读审 diff | **`xrk-code-review`** |

系统路由段由 Host 注入 `tool:subagent`（仅徽章允许子代理时）。
