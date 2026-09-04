---
name: xrk-delegate
description: >-
  When and how to spawn subagents without wasting tokens. Use when the user asks
  to parallelize, spawn agents, 「开子代理」「并行」「delegate」「fan out」, or
  after Frugal/Shallow badge questions about subagents.
---

# 委派子代理

每个子代理 = **一整段模型会话**。默认自己做；只有任务独立、会污染本会话上下文时才 `subagent`。

```
- [ ] 1. 看会话徽章：Frugal = 无子代理；Shallow = depth≤1；Harness = 可嵌套
- [ ] 2. 写完整 standalone `prompt`（路径、验收、约束）；短 `description`
- [ ] 3. 默认同步等待；仅长任务 / 要续聊用 `run_in_background: true`
- [ ] 4. 背景子：`list_agents` · `send_message` · `interrupt_agent`；勿轮询
- [ ] 5. 并发宜少（默认封顶约 4 个活跃子）；宁要几个独立子，不要深链
```

## 何时委派

| 适合 | 不适合 |
|------|--------|
| 独立调研 / 范围清晰的实现片 | 「帮我继续刚才的活」（上下文在父会话） |
| 只读 review（可配 **`xrk-code-review`** brief） | 一步就能做完的小改 |
| 互不依赖的并行片 | 为刷进度开一堆空子 |

撞 depth / active 上限 → 先收尾或 `interrupt_agent`，再开新的。

系统提示 `tool:subagent` 与工具描述为准。
