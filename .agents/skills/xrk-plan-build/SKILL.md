---
name: xrk-plan-build
description: >-
  Plan then build on the same session: enter plan mode, draft a headed markdown
  plan, exit_plan_mode for approval, then implement. Use when the user asks for
  a plan, design-first work, 「先计划」「plan mode」「Plan 徽章」「exit_plan_mode」,
  or Codex/Cursor-style Plan → Build.
---

# Plan → Build（同会话）

XRK **没有**单独的 Build 徽章。选 **Plan** 徽章新建会话会默认进入计划模式；其它徽章可用 `/plan` 打开。批准离开计划模式后，**同一会话、同一工具面**继续实现。

```
- [ ] 1. 确认是否已在计划模式（Plan 徽章 / `/plan` / 投影 plan.active）
- [ ] 2. 只读探索：读相关文件，不写业务改动
- [ ] 3. 写出以 `#` 标题开头的完整 markdown 计划
- [ ] 4. 调用 `exit_plan_mode`（须 `#` 标题）；等用户 Approve / Keep planning
- [ ] 5. 批准后按计划实现；Keep planning → 修订计划再提审
```

## 规则

| 做 | 不做 |
|----|------|
| 计划阶段少改文件、多读 | 计划未批准就大范围写码 |
| `exit_plan_mode` 的 `plan` 以 `# ` 开头 | 空计划或无标题 |
| 批准后立刻动手 | 再开一个会话「当 Build」 |

`/plan off` 也可退出计划模式（斜杠）。详情：[docs/profiles.md](../../../docs/profiles.md)。
