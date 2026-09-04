---
name: xrk-code-review
description: >-
  Read-only, defect-first code review (Codex review-agent style). Use when the
  user asks to review a diff, PR, commit, or uncommitted changes, or says
  「审一下」「code review」「找缺陷」「review this」.
---

# Code review（只读）

检查请求的目标，返回**每一个**作者会想修的可行动发现。  
**不要**改文件、commit、push、代发评论，或再委派一轮空转 review。

```
- [ ] 1. 读适用的 AGENTS / 项目规则
- [ ] 2. 看完整 diff + 足够上下文
- [ ] 3. 只报本改动引入的真实缺陷；扫完全部再总结
- [ ] 4. 对照测试与调用点确认可行动
```

## 何时报

同时满足：影响正确性/安全/性能/可维护性 · 离散可修 · **由本次改动引入** · 可从代码演示 · 作者知情会修。

不报：臆测、既有债、故意行为变更、无关风格。

## 输出格式

先按严重度列出发现，每条：

`[P1] 祈使标题 — path/to/file.ts:line`

紧跟一小段：场景 + 为何错。引用范围尽量小且落在 diff 内。

| 级 | 含义 |
|----|------|
| P0 | 发布阻断 / 严重失败 |
| P1 | 应尽快修 |
| P2 | 普通缺陷 |
| P3 | 低影响仍值得修 |

无合格发现 → `No findings.`  
文末一句总评 + 测试缺口/残留风险。大 diff 可 `subagent` 委派只读审查（完整 brief），见 **`xrk-delegate`**。
