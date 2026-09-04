# Subagents（本仓产品工作区）

对标 DSH 委派习惯 + Codex review/plan：子代理是**独立会话**，不是免费线程。

## 默认

- 小改自己做；独立调研 / 范围清晰的实现片 / 只读 review 再用 `subagent`。
- `prompt` 必须自包含（子看不到父 transcript）。
- 默认同步等待；长任务才 `run_in_background` + `send_message` / `interrupt_agent`。
- **Frugal** 徽章无子代理工具；省钱就选它或少 spawn。**Shallow** 仅一层。

## 剧本

| 意图 | Skill |
|------|--------|
| 何时委派 / 封顶 | **`xrk-delegate`** |
| Plan → Build | **`xrk-plan-build`** |
| 只读审 diff | **`xrk-code-review`** |

系统路由段由 Host 注入 `tool:subagent`（仅徽章允许子代理时）。
