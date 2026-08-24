---
name: xrk-plugin-dev
description: >-
  XRK-Harness 插件体系总览：loader discover、preset 接线、Face inventory、extensions 金样。
  改 packages/server/loader、presets 插件线、Face plugin 面或 extensions/* 时使用。
disable-model-invocation: true
user-invocable: false
---

# 笔记 · 插件体系（Harness）

教科书：[docs/plugin-development.md](../../../docs/plugin-development.md) · [docs/plugin-loader.md](../../../docs/plugin-loader.md) · [docs/profiles.md](../../../docs/profiles.md)。

## 权威入口

| 主题 | 文档 | 代码 |
|------|------|------|
| 开发流程 | [plugin-development.md](../../../docs/plugin-development.md) | `extensions/example-tools/` |
| Loader 契约 | [plugin-loader.md](../../../docs/plugin-loader.md) | `packages/server/loader/` |
| Preset 接线 | [profiles.md](../../../docs/profiles.md) · [host-preset.md](../../../docs/host-preset.md) | `presets/*/preset.ts` |
| 社区包 | [community-plugins.md](../../../docs/community-plugins.md) | `packages/server/http/src/dsh-compat/` |
| 产品 coach 种子 | [templates/xrk-harness/](../../../templates/xrk-harness/) | `.xrk` inject + `skills/` |

## 数据流（进程插件）

```text
XRK_PLUGINS_DIR / ~/.xrk/plugins
  → loadAll() → RegisteredPlugin[]
  → preset createAgent / composition
  → wireCompositionTools | wireCompositionPrompts | commands
  → Face inventory + slash
```

- **不要**在 preset 写业务逻辑；只接线。
- **不要**写 `kind: cordis` 进仓期望自动 apply（discover only）。
- 同名 **builtin** 工具 / 保留 **prompt id** 不可被插件覆盖。

## 适用场景

- 新增或修改 `extensions/*` 金样
- 改 `@xrkseek/server-loader` discover / manifest 解析
- 改 preset 如何 `wireComposition*`
- 改 Face `pluginInventory` / `commands/*` / slash
- 同步 `templates/xrk-harness` 教练文案或产品 skills

## 非适用场景

- 只帮**用户**在工作区写一个插件 → 产品 skill **`xrk-plugin-author`**（不改内核）
- MCP 服务器包作者 → **`xrk-mcp-plugins`**
- 社区 client 安装 → **`xrk-community-plugins`**
- 改 tool pipeline / policy 守卫 → [docs/tool-pipeline.md](../../../docs/tool-pipeline.md)

## 执行步骤

1. 读 [docs/status.md](../../../docs/status.md) 确认能力可依赖。
2. 定 kind：`tools` | `prompt` | `commands`（见 **`xrk-extensions`**）。
3. 对照 `extensions/example-tools` 最小形；改 loader 时补 `packages/server/loader/tests`。
4. Preset 改动：跑对应 preset 测 + `pnpm check`。
5. 若改契约：同步 `docs/plugin-development.md` / `plugin-loader.md` / `status.md`。
6. 产品 coach：同步 `templates/xrk-harness/`（`assistant.md` · `skills/` · recipes）。

## 本机试跑

```bash
# 源码仓，不安装到 ~/.xrk/plugins
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js web --workspace .

# 或 CLI 安装后必须 restart（无热重载）
xrkh plugin add ./extensions/example-tools
xrkh restart
```

重载：**`xrkh restart`**（pid 锁停本 Host）。`--force` 只杀已识别 XRK 监听。

## 常见陷阱

| 陷阱 | 正确 |
|------|------|
| 假装 `plugin add` 后立刻生效 | 必须 `restart` |
| 插件依赖 `apps/*` 私有路径 | 只走 `@xrkseek/*` 公开面或纯 JS 插件 |
| 把 Cordis `apply(ctx)` 当进程插件 | 见 community-plugins；进程 kind 只有 tools/prompt/commands |
| 维护者 `.cursor/rules` 灌进产品 Agent | 规则加 `xrk-inject: false` |
| 复制 AGT 的 PluginBase 事件模型 | Harness 是 ToolDefinition + createPlugin，不是 Tasker 插件 |

## 相关 skill

- **`xrk-extensions`** — kind 字段与 execute 形  
- **`xrk-mcp-plugins`** — MCP 与进程插件边界  
- **`xrk-workspace-skills`** — 产品 SKILL.md 与种子  
- **`xrk-docs-audience`** — 改 docs 时
