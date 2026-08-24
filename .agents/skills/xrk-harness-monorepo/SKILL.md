---
name: xrk-harness-monorepo
description: >-
  工作区根为 XRK-Harness 源码仓：写 extensions/ 插件沙箱、只读内核、技能路由。
  用户把 harness 设成工作区写插件时使用。
---

# Harness monorepo 插件工作区

## 工作循环

1. 缺结构认知 → **`xrk-harness-architecture`**
2. 确认 Workspace root inject — 勿搜其它盘符
3. 写插件 → **`xrk-plugin-author`** → `extensions/<plugin-id>/`
4. 验证 → **`xrk-plugin-verify`**

## 写入落点

| 产物 | 路径 |
|------|------|
| 新插件 | `extensions/<plugin-id>/` |
| 契约示例 | `docs/plugin-development.md`（只读） |

**禁止**默认改 `packages/` · `apps/` · `presets/`。

## 任务路由

| 用户说 | 顺序 |
|--------|------|
| 写 ping 插件 | author → verify |
| kind 不确定 | kind → author |
| git pull 后 | verify（lock 变才 pnpm install） |
