---
name: xrk-plugin-verify
description: >-
  验证 XRK 插件：plugin add、restart、工具 inventory、git pull 后何时 install。
  用户说「装好了吗」「工具看不到」时使用。
---

# 插件验证

1. manifest 与 `createPlugin()` 的 id/kind 一致
2. `xrkh plugin add ./extensions/<id>` → `xrkh restart`（或 `XRK_PLUGINS_DIR=./extensions xrkh web`）
3. `xrkh plugin list` · 徽章 **harness** · 必要时新 session
4. **git pull 后**：仅 lock/package.json 变才 `pnpm install`；插件 JS 改动只需 restart

无热重载。`--force` 只停已识别 XRK Host。
