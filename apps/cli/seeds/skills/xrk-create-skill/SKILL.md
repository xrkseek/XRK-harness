---
name: xrk-create-skill
description: >-
  Author an XRK product skill (SKILL.md + frontmatter) that teaches the agent a
  repeatable workflow. Use when the user says 「写 skill」「create skill」
  「教 agent」「自我升级」「加一条习惯」.
---

# Create skill

结构同 Cursor Agent Skill：`skill-name/SKILL.md` + YAML frontmatter。  
目标：**改模型决策**，不是写说明书。差 skill = 模糊触发 + 堆事实 + 无检查清单。

```
- [ ] 1. 定范围：跨项目习惯 vs 仅本仓库
- [ ] 2. 写 description：WHAT + WHEN + 用户原话触发语（中英均可）
- [ ] 3. 正文：checklist → 何时用/不用 → 工具与约束 → 反模式
- [ ] 4. 落盘后提示用户新 turn，或 `skill.list` 确认可见
```

## 放哪

| 范围 | 路径 |
|------|------|
| 仅本仓库 / 用户自建（推荐） | `{workspace}/.agents/skills/<name>/` 或 `.xrk/skills/`（用户明确同意再建） |
| 产品默认种子（勿手改） | `~/.xrk/skills/<bundled-name>/` — Host 按指纹镜像覆盖 |
| 跨项目习惯（非种子名） | 也可 `~/.xrk/skills/<custom-name>/`（不会被 bundled 列表覆盖） |

Host 启动把产品种子镜像到 `~/.xrk/skills/`：指纹与 bundled 不一致（或缺文件）→ 覆盖写入。  
**自定义 skill / AGENTS 写工作区** `.agents/skills/` 或 `.agents/AGENTS.md`（或 `.xrk/`），不要改 home 里的默认种子副本。

## Frontmatter

```yaml
---
name: my-skill
description: >-
  第三人称：做什么 + 何时用；写入用户可能说的原话。
---
```

| 要求 | 说明 |
|------|------|
| 发现靠 description | 正文再长，匹配不上就不加载 |
| 一默认路径 + 一逃生口 | 例如默认 `~/.xrk`，逃生「用户要工作区限定」 |
| 正文宜短 | 决策约束优先；大 schema / 长示例放 `references/`，用到再读 |
| 非法布尔 frontmatter | 整 skill 丢弃 |

## 正文质量（提示词工程）

好 skill 像好工具描述：

1. **Intent 门** — 「必须 / 不要」对照，防止误触发  
2. **有序 checklist** — 模型可勾选执行，不是散文  
3. **做 / 不做表** — 堵住已知失败模式  
4. **具体工具名与参数形状** — 禁止「适当调用相关 API」  
5. **反模式** — 写进真实翻车（贴表代替画布、空子代理刷进度…）

坏 skill 特征：只有概念介绍、无触发边界、无步骤、堆维护者黑话、假设当前仓库是 Harness monorepo。

范型可读：`xrk-plan-build` · `xrk-delegate` · `xrk-code-review` · `xrk-canvas` · `xrk-capability-attach`。

## Standing rules（对标 Cursor create-rule）

| Cursor | XRK |
|--------|-----|
| `.cursor/rules/*.mdc` | `.agents/AGENTS.md` · `rules.md` · `context/*` |
| `alwaysApply` | 写进 `AGENTS.md` 角色/边界 |
| `globs` | 任务 skill 或 `context/` 分文件 |

工作区**不会**自动建 `.agents`；会话在 `~/.xrk/sessions`。密钥进 Credentials，不进 skill 正文。
