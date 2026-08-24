# 工作区写插件（常驻边界）

> 对照 XRK-AGT `agents/rules/workspace-dev.mdc`。

## 边界

- **写**：`extensions/<plugin-id>/`
- **读**：`docs/plugin-development.md` · `docs/plugin-loader.md` · `.agents/skills/`
- **勿改**（除非用户明确要求维护内核）：`packages/` · `apps/` · `presets/` · `.cursor/`
- 用户说「写插件」→ **直接 write** 到 `extensions/`，禁止空转全仓搜索

## monorepo 布局

| 路径 | 用途 | 插件作者 |
|------|------|----------|
| `extensions/` | 用户插件 + 内置 `dsh-compat` | **写入** |
| `.agents/skills/` | 架构 + 插件 coach（catalog 自动扫） | 只读 |
| `docs/` | 契约 | 只读 |
| `packages/` · `apps/` · `presets/` | 内核 | **勿写** |

## 最小 tools 骨架

`extensions/<plugin-id>/plugin.mjs` — 完整示例见 `docs/plugin-development.md`。

## 试跑

```bash
XRK_PLUGINS_DIR=./extensions xrkh web --workspace .
xrkh plugin add ./extensions/<plugin-id> && xrkh restart
```

徽章 **XRK Harness**（`harness`）。无热重载。
