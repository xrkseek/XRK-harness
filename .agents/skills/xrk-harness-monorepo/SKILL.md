---
name: xrk-harness-monorepo
description: >-
  工作区根为 XRK-Harness 源码仓：写 extensions/ 插件沙箱、只读内核、技能路由。
  用户把 harness 设成工作区写插件时使用。
---

# Harness monorepo 插件工作区

## 工作循环

1. 缺结构认知 → **`xrk-harness-architecture`**
2. 挂 MCP / 外部工具 → 家目录 skill **`xrk-capability-attach`**（`skill` 加载；种子 `~/.xrk/skills`）
3. 配模型 / API → 家目录 **`xrk-models-settings`**
4. 确认 Workspace root inject — 勿搜其它盘符
5. 写插件 → 家目录 **`xrk-plugin-author`** → `extensions/<plugin-id>/`；斜杠 **`/plugin-scaffold`**
6. 验证 → 家目录 **`xrk-plugin-verify`**

## 写入落点

| 产物 | 路径 |
|------|------|
| 新插件 | `extensions/<plugin-id>/` |
| 契约示例 | `docs/plugin-development.md`（只读） |

**禁止**默认改 `packages/` · `apps/` · `presets/`。

## 任务路由

| 用户说 | 顺序 |
|--------|------|
| 装 MCP / attach | capability-attach |
| 配模型 / 模型 ID | models-settings |
| 写 ping 插件 | author → verify |
| kind 不确定 | kind → author（或 capability-attach） |
| git pull 后 | verify（lock 变才 pnpm install） |
