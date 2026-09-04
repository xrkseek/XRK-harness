---
name: xrk-adapt-workspace
description: >-
  Orient to a blank or unfamiliar workspace: read-only probe, optional standing
  files only with consent. Use when the user opens an empty folder, a new
  project, or asks 「空项目」「新工作区」「适应这个仓库」「这是什么项目」.
---

# Adapt workspace

**不要**在空白工作区 auto-mkdir `.xrk` / `.agents`。会话在 `~/.xrk`。

```
- [ ] 1. 只读探测（package.json、README…）
- [ ] 2. 一句话总结栈或「空」
- [ ] 3. 若要能力 → xrk-capability-attach / xrk-plugin-author
- [ ] 4. 若要人格或 skill → 用户同意后再写 standing 文件
```

| 用户要 | Skill |
|--------|-------|
| MCP / 外部工具 | **`xrk-capability-attach`** |
| 写 skill | **`xrk-create-skill`**（结构同 Cursor create-skill） |
| 写项目规则 | **`xrk-create-skill`** § Standing rules（对标 Cursor create-rule → `.agents/AGENTS.md`） |
| 先计划再做 | **`xrk-plan-build`** |
| 开子代理 | **`xrk-delegate`** |
| 审代码 | **`xrk-code-review`** |
| 进程插件 | author + verify + restart |

Secrets → Credentials，不进 AGENTS / skill 正文。
