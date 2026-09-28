---
name: xrk-community-plugins
description: >-
  社区 client 包、xrk.host.json、host.mjs 与 dsh-compat 兼容器（A–J 层级）。
  装社区壳、写 host 半包或改 packages/server/http/dsh-compat 时使用。
disable-model-invocation: true
user-invocable: false
---

# 笔记 · 社区插件与 dsh-compat

教科书：[docs/community-plugins.md](../../../docs/community-plugins.md) · 实现笔记：[packages/server/http/src/dsh-compat/README.md](../../../packages/server/http/src/dsh-compat/README.md)。

## 架构（一句话）

社区 **`client.js`** 走 Face / 同源 HTTP → **能力表** + XRK 底层（`~/.xrk`）→ **bridge** → 未列路径诚实 JSON（非 SPA 404）。

内置兼容器：`extensions/dsh-compat`（`kind: host`）。

## 接入层级 A–J（装包前先归类）

| Tier | 触发 | Host |
|------|------|------|
| A | 仅 Face / 壳 API（含面板 `dynamicCordisRunner/*`） | 通常直接可用；不嵌 Cordis Host |
| B | 全局能力表 | XRK 持久化 |
| C | `*-settings` RPC | settings store |
| D | `/_dsh/<pkg>/…` | 通用 JSON |
| E–G | slug / catch-all / 未注册 POST | 诚实降级 |
| H | `xrk.host.json` | 作者声明 provider |
| I | `host.mjs`（含面板 `runHostHalf`） | 进程内 apply；失败 I′ 子进程 |
| J | 外部云端发行版 | 见 status「未做」 |

**不要**把「未实现」写成已支持；对照 [docs/status.md](../../../docs/status.md)。

## 与进程插件 / Desktop 安装面边界

| | 进程插件 | 社区 host/client | Desktop 插件安装面 |
|--|----------|------------------|-------------------|
| Manifest | `xrk.plugin.json` | 常含 `xrk.host.json` + `host.mjs` / client 包 | profile 依赖图（npm name/version） |
| 目的 | 模型工具 / prompt / 命令 | 壳 UI · Host RPC 形状兼容 | 桌面 profile 可执行闭包 |
| 安装 | `xrkh plugin add` | 同 CLI + 可能 **`web/boot.json` overlay** | 结构化 list/add/remove/update + 内置 pnpm（设计；未就绪） |
| 重载 | **`xrkh restart`** | 同左 | Desktop Host / 壳生命周期（实现时） |

**不要**把 Desktop 安装通道与社区 web overlay / dsh-compat 能力表混为一谈。教科书边界表：[docs/community-plugins.md](../../../docs/community-plugins.md)「Desktop 插件 vs 社区 client」。

## 权威入口

| 主题 | 路径 |
|------|------|
| 能力矩阵真源 | `dsh-compat-matrix.ts` |
| 回归 fixture | `packages/server/http/tests/fixtures/compat-host-suite.json` |
| 金样 host 插件 | `extensions/dsh-compat/` |

## 执行步骤（改兼容器）

1. 读 community-plugins + dsh-compat README。  
2. 新 RPC：优先扩 capability table / bridge，**不要** embed Cordis Host（ADR-0002）。  
3. 补 http 测或 fixture 条目。  
4. 同步 `docs/community-plugins.md`（**已适配社区包清单**）· `status.md`（已实现 vs 待补）。

## 常见陷阱

- 按**包名**堆适配器 — Harness 按**路径与 RPC 形状**接线。  
- 对上游第三方仓提 PR — **禁止**（产品身份规则；ADR-0002）。  
- 把 maintainer `.cursor` 笔记当社区包规格。  
- **Client 半部装完「没反应」**：列表会标 `needsRestart`；Desktop 热刷新只重载渲染页，**不会**重挂 `webPlugins` — 首次装 client 包要整应用 / Host 重启。  
- **启停 / 删除 / 重载 / 更新**：与安装一样引导刷新（toast + `clientRefreshHint` 横幅 + 待重启标签上的刷新按钮）；卸载必须传 `clientRefresh: true`（否则条目标没了看不见 `needsRestart`）。  
- **Settings 卡看不见**：社区包常双注册 `settings.plugin.item` + `plugins.bundle.config`。Configurable 标签页在 Host `describe` 之后派发**全部已注册** `settings.plugin.item` 键（含 Face 未列出的自托管键，如 `modlens`）；`plugins.bundle.config` 已声明供 inject，配置面仍走 Settings 卡。  
- **`@liustack/modlens` 粘贴无反应**：client 先 `GET /modlens/paste?model=`，要 `{ takeover: true }` 才劫持粘贴；关 `pasteToPath` 时 Host 回 404。二进制 `POST /modlens/paste` → `{ path }`。  
- **`dsh-niulai-pet`**：client-only 桌宠（`createRoot` 挂 body，非 `shell.overlay`）；Settings 卡键 `niulai-pet`；语音停喊要 `GET /niulai-kws/*`（Host 白名单伺服 staged `kws/`）— 装包时 `installClientBundle` 需拷贝 `kws/` 资产目录。  
- **皮肤包**（`@smalltailqwq/dsh-client-ui-skin-*` · `dsh-dream-skin` · `@linxin666/dsh-skins` · `dsh-client-ui-aqua`）：
  - client 用相对 URL `skin-assets/<skinId>/<hash>.webp` → Host `/skin-assets/*`（staged `assets/runtime/` + `skin.json` id）。
  - 装包时拷贝 `assets/` · `preview/` · `locale/` · `skins/` · `skin.json`。
  - 管理器：`/api/dsh/skins`（deep-whale-manager）· `/api/skin-manager` · `/api/skin-center/v2|*`（linxin skin-center）— 共用 `skin-discover` 扫描 staged `skin.json`。
  - **aqua / open-sea / liang-intensity**：client-only（Settings 卡 / body 装饰）；无 Host HTTP；装后重启即可。
  - 缺图即「渲染异常」；管理页 404 即缺上述 HTTP 能力。
- **inject remap**：`@deepseek-ai/dsh-api-remotes` → `@xrkseek/xrk-api-remotes`（`remap-inject` + `dsh-require-remap` 同表）；缺映射会装上但 shell require 失败。
- **`dshmarket` 装/更/卸**：`POST /dsh-market/install|update|uninstall` → `runPluginMutate`（与 Settings 清单同路径）。Discover 只传 github `url`——Host 用 awesome catalog 把 `url` 映射成 `npm`（避免把 `@scope/pkg` 当本地路径、或裸 git URL 装坏已适配包）。`XRK_MARKET_MUTATE_NPM=0` 仅本地路径。`GET /updates` 空对象。
- **火插件形状**（非裸 stub）：`/api/pet/*` · `/api/billing/*` · `POST /mcp-connector/api`（连接可 upsert）· `/plugins/dsh-agent-teams/state|plan|halt` · `/token-usage-stats` · `/api/dsh-skills-manager/*`（扫描 + enable/trash）· `/api/task-board` CRUD · `/api/dsh-ssh/hosts` · `/api/dsh-codex-ui/preferences` · `/api/pair/*` · `/api/michengai/*` · `/api/install` · `/server-deck/api/*` · `/univer-api/*` · `/scene-frame|scene-anim` · `/api/dsh-context/detail` → `{ ok, value }` · `/api/dsh-free-search-settings/*` · `/api/code-server/*`（与 `/code-server/*` 同形）· `/_dsh/dsh-email/settings`（save/serialize；IMAP deferred）。  
- **底层 persist**：`/_dsh/<pkg>/{settings,config,state}` 与 `/dsh-*/api/{config,state}` → `~/.xrk/community-surfaces/<id>/`（`plugin-surface-store`）；settings mutate 支持嵌套 `path`；`xrk-stub-rpc` generic set/get 同落盘；遗留 `/dsh-pet-7340/config` 专用 store。  
- **本机社区镜像（搜索/适配）**：`node scripts/dsh-community-mirror.mjs` → `~/.xrk/community-plugin-mirror/`（catalog.json · index.json · packs/）。`--search=hud` 本地搜；全量 pack 可 resume（单包失败不中断整轮）。

## 相关

- **`xrk-plugin-dev`** — 进程插件主线  
- **`xrk-docs-audience`** — 写 community-plugins 文档时
