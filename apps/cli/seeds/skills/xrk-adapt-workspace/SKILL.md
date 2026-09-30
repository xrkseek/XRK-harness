---
name: xrk-adapt-workspace
description: >-
  Orient to a blank or unfamiliar workspace with read-only probe; only write
  standing files with consent. Use when the user opens an empty folder, a new
  project, or asks 「空项目」「新工作区」「适应这个仓库」「这是什么项目」.
---

# Adapt workspace

空白 / 陌生工作区：**先只读探测**。不要擅自建 `.agents` / `.xrk`，不要把 `~/.xrk` 全局习惯写进仓库。

```
- [ ] 1. 只读：README、package.json、锁文件、明显入口 — 不改文件
- [ ] 2. 一句话总结栈，或明确说「空目录」
- [ ] 3. 问清用户下一步（加 MCP / 写 skill / 开干）再动手
- [ ] 4. 需要 standing 人格或仓库规则 → 用户同意后再写
```

## 路由

| 用户要 | Skill |
|--------|-------|
| MCP / 外观 / Host 设置 | **`xrk-capability-attach`** |
| 配模型 | **`xrk-models-settings`** |
| 写 skill | **`xrk-create-skill`** |
| 先计划再做 | **`xrk-plan-build`** |
| 开子代理 | **`xrk-delegate`** |
| 审代码 | **`xrk-code-review`** |
| 看板 / 画布 | **`xrk-canvas`** |
| 进程插件 | **`xrk-plugin-kind`** → author → verify |

## 反模式

- 空仓库里自动生成一堆脚手架「显得有用」  
- 未同意就写 AGENTS / skill  
- 密钥写进 AGENTS 或 skill 正文
