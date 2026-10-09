---
name: xrk-plan-build
description: >-
  Plan then build on the same session: enter plan mode, put the path on a
  workspace Canvas, keep chatting; user may press Build (or chip × / /plan off).
  Use when the user asks for a plan, design-first work, 「先计划」「plan mode」,
  or Codex/Cursor-style Plan → Build.
---

# Plan → Build（同会话）

XRK **没有**单独的 Build 徽章。Plan 是**协作姿态芯片**（`/plan` 或芯片），不是工具面徽章。交付物是工作区 **Canvas**（`canvas_upsert` + Overview「画布」）。**Build 只是按钮**：关 Plan + 可选催实现；不点也能继续聊，回合照常结束。

```
- [ ] 1. 确认是否已在计划模式（芯片 Plan / `/plan` / 投影 plan.active）
- [ ] 2. 只读探索：读相关文件，少写业务改动（硬闸仍是权限轴）
- [ ] 3. `canvas_upsert` 写清：目标 / 路径 / 风险 / 验收；口头说草案就绪
- [ ] 4. 正常结束本轮 — **不要**等用户点 Build；可继续改计划
- [ ] 5. 用户 Build / 「按这个做」/ 芯片 × 后：同一会话、同一工具面实现
```

## 规则

| 做 | 不做 |
|----|------|
| 计划写上 Canvas；见 `session_capability` 的 `plan: on` | 把 Build 当成回合闸门或「批准后才能继续」 |
| 软只读：多读少改 | 计划未就绪就大范围写码 |
| 用户可继续聊、改约束 | 强制 `exit_plan_mode` 全屏审阅当主路径 |
| 芯片 × = 只退出；Build = 退出 + 催实现 | 再开一个会话「当 Build」 |

兼容：旧 `exit_plan_mode` + plan-review 仍可用，但新产品以 Canvas + Build 为主。`/plan off` 也可只退出姿态。
