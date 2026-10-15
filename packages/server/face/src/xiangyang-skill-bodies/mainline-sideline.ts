/** Xiangyang skill body: 主线 pin + 支线 tips for Qichuang. */
export const ID = "xrk-mainline-sideline";

export const BODY = `---
name: xrk-mainline-sideline
description: >-
  Keep 主线 (thread pin) and 支线 (presence tips) meaningful while
  orchestrating from Xiangyang. Use when starting multi-session work,
  pinning peers, or when catalog titles look empty / duplicated.
---

# 主线 · 支线（奇创）

| 概念 | 工具 | 作用 |
|------|------|------|
| **主线** | \`thread_upsert\` / \`thread_list\` / \`thread_delete\` | 发现钉：兄弟会话在 collab board 上找到「在做什么」 |
| **支线** | \`presence_set\` \`tips\` 或 \`sideline_set\` | 本会话侧栏一行近况 |
| **互信** | \`thread_message\` | 任意父会话互发（可跨工作区）；**不要求**先挂钉 |
| **派工** | \`workspace_session_prompt\` | 在编码区新建/续用并派第一句；返回 \`session_id\` |

主线是**加速器**不是门槛；但零基础多会话场景下，**不钉 = 侧栏不可发现 = 体验像没有主线**。

## 该钉时

1. \`workspace_session_prompt\` 拿到 \`session_id\` 后立刻：  
   \`thread_upsert({ title, brief, session_id, workspace_id })\`。  
2. \`title\` = 短任务名；\`brief\` = 一两句让别人看懂。  
3. **禁止**空 brief、重复 \`mainline-a\`、把主线当进度日志。  
4. 本会话开工：\`thread_upsert({ title, brief })\`；结束且不再需要被发现 → \`thread_delete\`。  
5. 定期 \`thread_list\`：空 brief / 测试残留 / 重复名 → 删或改。

## 支线

- 开始、卡住、等回复、收工：\`presence_set({ tips: "…" })\`（可顺带表情）。  
- 进度细节用 \`todo_write\`；不要把主线当看板。

## 与需求转化

模糊需求经 \`xrk-demand-translate\` 选定编码工作区后，派工**必须**带主线钉 + 支线更新，用户才能在侧栏感到「主线/支线」。

## 反模式

- 只 \`workspace_session_prompt\` 不 \`thread_upsert\`。  
- 每个子任务一条主线。  
- 以为没钉就不能 \`thread_message\`。
`;
