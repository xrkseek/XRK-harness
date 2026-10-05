---
name: xrk-delegate
description: >-
  When and how to spawn subagents without wasting tokens. Use when the user asks
  to parallelize, spawn agents, 「开子代理」「并行」「delegate」「fan out」, or
  after Frugal/Shallow badge questions about subagents.
---

# 委派子代理

每个子代理 = **一整段模型会话**，默认与父会话**同一工作区**。默认自己做；只有任务独立、会污染本会话上下文时才 `subagent`。

```
- [ ] 1. 看会话徽章：Frugal / minimal / shell = 无子代理（名册命中也用 Skills，不要 spawn）；Shallow = depth≤1；Harness = 可嵌套
- [ ] 2. `team_list`（或看 `subagent` 工具描述里的名册）选 `member_id`；没有合适干员再用 `role`
- [ ] 3. 写完整 standalone `prompt`（路径、验收、约束）；短 `description`。人设已在干员 playbook 里就不要再抄一遍
- [ ] 4. 选形状：默认前台 one-shot；续聊 / 陪聊必须 `run_in_background: true`
- [ ] 5. 需要本会话已完成轮次时才 `inherit_context: true`；不要让子代理读 AGENTS.md 找自己是谁
- [ ] 6. 背景子：`followup_task` · `send_message` · `wait_agent` · `interrupt_agent` · `list_agents`
- [ ] 7. 并发宜少：默认同时存活 ≤2、深度 ≤2（深度上限 3），见设置 → 插件 → Agent loop
```

## 何时委派

| 适合 | 不适合 |
|------|--------|
| 独立调研 / 范围清晰的实现片 | 「帮我继续刚才的活」却不设 `inherit_context` |
| 只读 review（可配 **`xrk-code-review`** brief） | 一步就能做完的小改 |
| 互不依赖的并行片 | 为刷进度开一堆空子 |
| 要续聊的伙伴（`run_in_background`） | 前台 one-shot 却指望用户继续打字 |

## 形状

| 意图 | 调用 |
|------|------|
| 做完即回 | 默认 `subagent`（one-shot，只读记录） |
| 长任务 / 陪聊 | `run_in_background: true`，之后 `followup_task` / `send_message` |
| 接着本会话做 | `inherit_context: true`（仅已完成轮次） |
| 隔离 git 树 | `worktree: true`（同仓库另一 checkout） |
| 专职工种 | **优先** `member_id`（Agent Team：工具 + 注入 + playbook）；没有合适干员才 `role` worker / researcher / reviewer / lead |
| 沉淀可复用流程 | 主会话 `team_save`（`scope` global 或 workspace） |

Face 会在子 prompt 前注入 parent/child session id、mode、role、cwd。`prompt` 里写任务本身。默认跟父会话同一模型；设置 → 插件 → Agent loop「子代理模型」可钉 `provider/model`。

撞 depth / active 上限 → 先收尾或 `interrupt_agent`，再开新的。

系统提示 `tool:subagent` 段与工具描述为准；徽章表见 [docs/profiles.md](../../../docs/profiles.md)。
