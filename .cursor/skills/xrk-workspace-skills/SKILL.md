---
name: xrk-workspace-skills
description: >-
  编写 Harness 产品 skill（.xrk/skills、templates/xrk-harness/skills）：
  frontmatter、catalog、与 recipes 分工。新增或改产品 SKILL.md 时使用。
disable-model-invocation: true
user-invocable: false
---

# 笔记 · 产品 skill（Harness）

分层：[docs/skills-layers.md](../../../docs/skills-layers.md) · 注入：[docs/workspace-inject.md](../../../docs/workspace-inject.md)。

## 两套 skill，不要混

| 层 | 目录 | catalog | 斜杠 |
|----|------|---------|------|
| **维护笔记** | `.cursor/skills/xrk-*` | `disable-model-invocation: true` | `user-invocable: false` |
| **产品 skill** | `.xrk/skills/<name>/` | **仅** `name` + `description` 进 catalog | `/name` 可展开 |

种子真源：`templates/xrk-harness/skills/` → `syncSeeds` → `{workspace}/.xrk/skills/`。

## 产品 SKILL 最小形

```text
.xrk/skills/my-skill/
  SKILL.md
  references/   # 可选
  scripts/      # 可选
```

```yaml
---
name: my-skill
description: 何时用：用户说「…」；做什么一句话（触发语写进 description）
---
```

```markdown
## 步骤
1. …
2. 契约细节 → 读 docs/plugin-development.md，不要凭印象编造 API
```

| 字段 | 要求 |
|------|------|
| `name` | 与目录名一致；kebab-case |
| `description` | **中文可**；必须含用户会说的触发语 |
| 正文 | 步骤优先；表格列真实 CLI / 工具名 |

**不要**在产品 skill 里复制整份 docs；**不要**写维护者红线（Node 26、禁止 commit 等）。

## 优先级（项目内多根）

低 → 高（后列覆盖同名）：`.codex` → `.claude` → `.agents` → `.cursor` → **`.xrk/skills`**。

插件教练三件套（种子）：

| Skill | 职责 |
|-------|------|
| `xrk-capability-attach` | MCP Settings 挂载（CLI `seeds/skills` → `~/.xrk/skills`） |
| `xrk-plugin-author` | 写脚手架、manifest、createPlugin |
| `xrk-plugin-kind` | kind / MCP 选型（默认 MCP） |
| `xrk-plugin-verify` | add · restart · 可见性 |

## recipes vs skills

| | recipes (`.xrk/recipes/*.yaml`) | skills |
|--|--------------------------------|--------|
| 触发 | `/recipe-id` 斜杠 | catalog 匹配 + `/skill-name` |
| 内容 | 固定 prompt 模板 | 分步 playbook |
| 示例 | `plugin-scaffold` · `mcp-attach` | `xrk-plugin-author` · `xrk-capability-attach` |

同名冲突：recipe 与 skill **不同命名空间**；避免同 id 混淆用户。

## 执行步骤（新增产品 skill）

1. **跨工作区默认**：写 `apps/cli/seeds/skills/<name>/SKILL.md`（随 CLI 发布 → `~/.xrk/skills`）。  
2. **本仓工作区教练**：写 `.agents/skills/<name>/SKILL.md`（Host 扫工作区 catalog）。  
3. 只 frontmatter `name` + `description`（无 `disable-model-invocation`）。  
4. 若改 inject 行为 → [docs/workspace-inject.md](../../../docs/workspace-inject.md)。  
5. 维护者索引 → [SKILL_INDEX.md](../SKILL_INDEX.md)。

## 常见陷阱

- 把 `.cursor/skills/xrk-plugin-dev` 复制到 `.xrk/skills` — 受众错误。  
- description 只写「插件开发」无触发语 — catalog 无法路由。  
- 超长正文挤占 inject 预算 — 细节放 `references/`，正文保持 checklist。

## 对照 XRK-AGT

AGT **`agent-build-skill`** = 本 skill 的产品侧写法；  
AGT **`agents/skills/standard/`** = Harness **`templates/xrk-harness/skills/`**。
