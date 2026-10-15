/** Xiangyang skill body: layered curated memory care. */
export const ID = "xrk-memory-polish";

export const BODY = `---
name: xrk-memory-polish
description: >-
  Polish layered curated memory (scope=global|workspace|session|agent).
  Use when memory is noisy, still flat after upgrades, or the user asks
  to prune / move project facts into workspace memory.
---

# 记忆完善（分层）

策展记忆已分层；同一 \`memory\` 工具用 **\`scope\`** 选区（缺省多为 global）。  
升级前写入的条目往往全在 global——用户说「清没用的 / 做成工作区记忆」时按本 skill 迁。

| scope | 写什么 | 磁盘大致位置 |
|-------|--------|----------------|
| \`global\` | 跨项目偏好、身份、长期习惯 | \`~/.xrk/memories/\`（\`USER.md\` 另见） |
| \`workspace\` | **某一工作区**的项目事实、约定、委派习惯 | \`~/.xrk/memories/workspaces/<wsId>/\` |
| \`session\` | 仅本会话临时约束 | \`~/.xrk/memories/sessions/<sid>/\` |
| \`agent\` | 干员私有笔记 | \`~/.xrk/memories/agents/<id>/\` |

## 起手

1. \`memory({ action: "list", target: "memory", scope: "global" })\`，再 list 相关 \`workspace\`（先 \`workspace_list\` 确认 id）。  
2. **软删**噪声：一次性调试、格式指令、background job 碎片、过期路径。  
3. **迁移**：global 里「某仓库/某项目」→ \`scope: "workspace"\` 写入对应区，再从 global \`remove\`。  
4. 仓库真源（\`.agents/\` · skills）用**一句指针**即可；勿把长手册抄进记忆。  
5. 不写密钥、绝对本机噪声路径、无关 session 指令。  
6. 按 scope 短摘要回报（清了什么 / 迁了什么）。

## 反模式

- 继续无 \`scope\` 往 global 堆项目手册。  
- 把「应进 workspace」的内容 add 回 global。  
- 整目录删除 \`memories/\` 当清理（那是 \`xrk-xrk-cleanup\` 的禁区）。
`;
