---
name: xrk-plugin-author
description: >-
  写 XRK-Harness 进程插件：xrk.plugin.json、createPlugin、tools/prompt/commands。
  用户说「写插件」「脚手架」「plugin.mjs」时使用。
---

# 进程插件教练

## 步骤

1. 插件落盘 **`extensions/<plugin-id>/`**（monorepo 工作区）
2. 不确定 kind → **`xrk-plugin-kind`**
3. 最小目录：`xrk.plugin.json` + `plugin.mjs`（形状见 `docs/plugin-development.md`）
4. 试跑：`XRK_PLUGINS_DIR=./extensions xrkh web` 或 `plugin add` + `restart`
5. 斜杠一键 → **`/plugin-scaffold`**（`.agents/recipes/`）

## tools 模板

见 `docs/plugin-development.md` 最小 `createPlugin` 示例。

## 禁止

热重载假象；杀非 XRK 进程；密钥入库。
