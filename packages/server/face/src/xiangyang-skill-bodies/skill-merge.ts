/** Xiangyang skill body: merge overlapping skills across layers. */
export const ID = "xrk-skill-merge";

export const BODY = `---
name: xrk-skill-merge
description: >-
  Merge overlapping skills across ~/.xrk/skills and workspace layers.
  Use when the catalog is noisy, duplicates conflict, or triggers misfire.
---

# 技能合并优化

Skill 分层（低 → 高覆盖意图以产品注入为准）：

| 层 | 路径 |
|----|------|
| 家目录 | \`~/.xrk/skills/<id>/SKILL.md\` |
| 向阳专用 | \`~/.xrk/xiangyang-workspace/.xrk/skills/\`（本空间产品 seed） |
| 工作区 | \`{workspace}/.xrk/skills/\` · \`{workspace}/.agents/skills/\` |

Catalog 只暴露 frontmatter \`name\` + \`description\`（触发词）；正文靠 \`skill\` / \`/name\` 展开。

## 步骤

1. 列出重复 \`name\` / 近似 description（家目录 vs 工作区 vs 向阳）。  
2. **真源一份**：项目专属 → 工作区；跨项目习惯 → \`~/.xrk/skills\`；向阳编排 playbook → 向阳 \`.xrk/skills\`（勿把产品 seed 抄进 harness 源码仓当唯一真源）。  
3. 更新留下的那份 \`description\` 触发词；删或缩小重复份（用户改过的：缺才写，或征得同意再改）。  
4. 抽查：\`skill\` 工具 / \`/skills\` / 新会话 catalog 是否干净。  
5. 向阳产品 seed 被旧正文卡住时：重启 Host 会按正文 diff 刷新；用户自建 id 不会被 seed 覆盖。

## 反模式

- 同名灌两份（\`~/.xrk/skills\` 与工作区各一份全文）。  
- 把长手册塞进 description。  
- 未经同意改用户手写 SKILL.md。
`;
