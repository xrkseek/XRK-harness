/** Xiangyang skill body: fuzzy-demand → product actions. */
export const ID = "xrk-demand-translate";

export const BODY = `---
name: xrk-demand-translate
description: >-
  Turn vague beginner asks into concrete XRK product actions (workspace,
  plugin, MCP, memory, cleanup, config). Use first when the user is fuzzy,
  zero-foundation, or says 「帮我弄一下」「能不能…」「感觉有点乱」.
---

# 需求转化（向阳 · 奇创）

你在 **向阳空间**（编排家），用户常常说不清技术细节。目标：**少问、快落地**，把模糊话变成产品能力，而不是空聊或空等源码仓。

## 转化表（先匹配再动手）

| 用户大概想… | 产品落点 | 下一步 skill / 工具 |
|-------------|----------|---------------------|
| 「加个能力 / 接某某 API / 让 AI 会某某」 | MCP 优先；否则进程插件 | \`xrk-home-config\`（MCP）或 \`xrk-plugin-dev-care\` |
| 「写个插件 / 扩展 / 斜杠命令」 | 用户**编码工作区**里的进程插件 | \`xrk-plugin-dev-care\` + \`workspace_session_prompt\` |
| 「磁盘好满 / .xrk 好 / 清缓存」 | \`~/.xrk\` 与项目 \`.xrk\` 清理 | \`xrk-xrk-cleanup\` |
| 「记性乱 / 老记错 / 分层」 | 策展记忆 scope | \`xrk-memory-polish\` |
| 「配模型 / 密钥 / 主题 / MCP」 | Settings + Credentials | \`xrk-home-config\` |
| 「技能重复 / catalog 吵」 | skills 分层合并 | \`xrk-skill-merge\` |
| 「开个项目 / 去某某文件夹干活」 | 工作区 + 编码会话 | \`workspace_list\` → \`workspace_create\` / \`workspace_session_prompt\` |
| 「多人协作 / 兄弟会话看到」 | 主线钉 + 支线 tips | \`xrk-mainline-sideline\` |

**没有 XRK-harness 源码仓也没关系**：插件模板与验证步骤写在 \`xrk-plugin-dev-care\` 里，落到**用户自己的项目工作区**或 \`xrkh plugin add\`，不要假设能读 monorepo。

## 固定流程

1. **一句话复述**你理解的目标（可改一句确认；零基础用户最多 1～2 个关键问题）。
2. **选路径**（上表）；用 \`skill\` / \`/skill-name\` 拉全量 playbook，不要凭记忆省略。
3. **编排**：
   - 配置 / 清理 / 记忆 → 本会话（奇创 full access）直接做。
   - 写代码 / 写插件 → \`workspace_list\` 选或建编码工作区 → \`workspace_session_prompt\`（保留 \`session_id\`，等回复）→ \`thread_upsert\` 钉主线 → \`presence_set\` 更新支线。
4. **交付**：告诉用户改了什么、如何验证（例如 \`xrkh plugin list\` / 新会话看工具名 / Settings 行）。

## 问与不问

| 要问 | 不要问 |
|------|--------|
| 落在哪个文件夹/工作区（若有多个） | 「你用什么框架 / 要不要微服务」等无关架构盘问 |
| 密钥是否已有（有则走 Credentials，无则引导设置） | 让用户贴 API key 进聊天 |
| 要 MCP 现成包还是自写小工具 | 「要不要先读源码」——产品 skill 已自带步骤 |

## 反模式

- 模糊需求只聊天不转化、不派工。
- 没有 harness 源码就说「没法写插件」。
- 在向阳里埋头改用户业务代码（应派到编码工作区）。
- 跳过主线/支线，侧栏全是无名会话。
`;
