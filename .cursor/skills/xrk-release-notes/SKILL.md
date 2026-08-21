---
name: xrk-release-notes
description: >-
  Write or revise XRK-Harness version release notes under docs/releases/ and
  GitHub Release bodies. Use when shipping a version, drafting v*.md, or editing
  publishing release checklist. Enforces DSH-style Added/Improved/Removed/Fixed
  sections; forbids diary voice.
disable-model-invocation: true
user-invocable: false
---

# 笔记 · 写发行说明

规则全文（打开 `docs/releases/**` 时自动挂载）：`.cursor/rules/xrk-release-notes.mdc`。  
对照：[DSH Releases](https://github.com/deepseek-ai/deepseek-harness/releases)（rc.8 等）。  
发版命令：[docs/publishing.md](../../../docs/publishing.md)。

## 动手顺序

1. 改 `apps/cli/package.json` → `version`（公开线真源）。  
2. 写 `docs/releases/vX.Y.Z.md`；从用户可见行为归类：**新增 · 完善 · 删除 · 修复**（+ 可选「其他变更」）。  
3. GitHub Release 正文与该文件同构。  
4. 若能力边界变了 → 同步 [status](../../../docs/status.md) 与相关契约。  
5. `pnpm release`（npmjs + GitHub Release）；安装示例版本号与包版本一致。

## 归类口诀

| 用户问 | 放哪 |
|--------|------|
| 以前没有、现在有 | **新增** |
| 已有能力更好用 / 更快 / 更清晰 | **完善** |
| 拿掉了、弃用了、不再支持 | **删除** |
| 坏了现在好了 | **修复** |
| 破坏性、工具链、仅维护者关心 | **其他变更** |

## 检查

- [ ] 四类标题齐（无内容的节可删，勿留空节）  
- [ ] 每条是结果句，无日记 / PR 堆砌  
- [ ] 破坏性在「其他变更」写明  
- [ ] 安装示例版本号正确  
- [ ] 未把 Agent 禁令或本机绝对路径写进发行说明  
