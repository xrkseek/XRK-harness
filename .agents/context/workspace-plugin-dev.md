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
| `extensions/example-tools` · `example-channel` · `dsh-compat` | 金样 / 内置适配（主仓白名单，可提交） | 对照只读；改金样需维护者意图 |
| `extensions/<其他 id>/` | 第三方 / 本地工作树（主仓默认 ignore） | **写入**；勿 `git add` 进 XRK-harness |
| `.agents/skills/` | 架构 + 插件 coach（catalog 自动扫） | 只读 |
| `docs/` | 契约（含「插件开发边界」） | 只读 |
| `packages/` · `apps/` · `presets/` | 内核 | **勿写** |

Client 叠加 / 侧栏 Host 契约：`docs/community-plugins.md`（Host 拥有 `/sidebar/*`）。

## 最小 tools 骨架

`extensions/<plugin-id>/plugin.mjs` — 完整示例见 `docs/plugin-development.md`。

## 试跑

```bash
XRK_PLUGINS_DIR=./extensions xrkh web --workspace .
xrkh plugin add ./extensions/<plugin-id> && xrkh restart
```

徽章 **XRK Harness**（`harness`）。无热重载。
