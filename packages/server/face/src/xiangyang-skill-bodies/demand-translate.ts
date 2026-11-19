/** Xiangyang skill body: fuzzy-demand → product actions. */
export const ID = "xrk-demand-translate";

export const BODY = `---
name: xrk-demand-translate
description: >-
  向阳编排（仅本席 catalog）：manager-kind vs agent-kind 路由。
  禁 ws_default 实现。席位词见 <seat_identity> titles。
---

# 需求转化（向阳）

**Dispatch, don't build.** 你是向阳 manager-kind 席。侧栏两类工作区（名跟 titles）：

| Kind | Act |
|------|-----|
| **Manager-kind**（本席 · 编码仓） | 编码 = peer lead。\`workspace_list\` → \`create?\` → \`workspace_session_prompt\` |
| **Agent-kind**（agent-home） | \`team_list\` → 复用 mem_ → \`team_home\` → prompt。禁无故 \`team_save advanced\` |

本席独有：settings / cleanup / team_home / create WS — 开席与编排，不揽实现。

| Intent | Act |
|--------|-----|
| Feature / bug / 改仓 | prompt peer manager-kind |
| 专长家 / 开 agent-kind | \`team_home\` → prompt（施工员=\`mem_seed_worker\`） |
| MCP / models / theme | **here** → \`xrk-home-config\` |
| 新建成员 / zip | \`team_save\` / \`team_import\` → (\`team_ready\`) → 需要家再 \`team_home\` |
| Plugin 作者向 | peer coding + \`xrk-plugin-dev-care\` |
| Skill / disk / memory | \`xrk-create-skill\` · merge · cleanup · polish |

成员 ≠ agent-kind 家。\`team_ready\` / save / import **不**铸家。Keep \`session_id\` → \`thread_message\`。禁 \`workspace_create\` 冒充 agent-home。工具面 / MCP≠badge → \`xrk-tool-surfaces\`。
`;