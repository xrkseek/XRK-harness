# 社区插件与 Host 契约

> **读者**：集成者 · 贡献者（安装社区 client、对照 Host 已实现能力与待补特性）

产品壳可加载社区 `client.js`。Host 侧由内置适配器 `extensions/dsh-compat` 与 `@xrkseek/server-http/dsh-compat` 按 **路径与 RPC 形状**接线，落盘与会话走 `~/.xrk`。实现笔记：[dsh-compat/README.md](../packages/server/http/src/dsh-compat/README.md) · 发包边界：[PACKAGE.md](../packages/server/http/src/dsh-compat/PACKAGE.md) · 发现：[plugin-loader.md](./plugin-loader.md)。

## 怎么安装与使用

1. 装 CLI 后打开工作区：`npx @xrkseek/harness-cli web`（或源码 `xrkh web`）。
2. 安装社区 client 包（落到用户插件目录）— CLI 或 **设置 → 插件 → 插件列表** 顶部安装框（`pluginInventory/install`，与 `xrkh plugin add` 同路径）：

```bash
xrkh plugin add <包名>
xrkh restart
```

示例包名：`dsh-wallet` · `@liustack/modsearch` · `xrkh-better-sidebar` · `@smalltailqwq/dsh-client-ui-skin-maid-atelier` 等（完整清单见下「已适配社区包清单」）。CLI 装完用 **`xrkh restart`**；Settings 装完进程半部会热 reconcile，client 半部按列表 `needsRestart` 硬刷新。

3. 日常开关、更新、删除与配置优先 **设置 → Plugins**（插件列表 + 各插件配置卡）；Host/CI 无头场景再用 env / 落盘文件。
4. 免补 `xrk.host.json`：loader 用能力表 + `client.js` 扫描 + 约定 infer（见 [plugin-loader.md](./plugin-loader.md)）。作者也可声明 `xrk.host.json` 或提供 `host.mjs`。
5. 能用什么、待补什么以本页「Host 能力」与 [status.md](./status.md) 为准。

## 架构

```text
community client.js
    → Face wire or same-origin HTTP / RPC
        → capability table + XRK underlying (~/.xrk)
        → bridge (XRK impl / optional subprocess apply)
        → unlisted paths: honest JSON (not SPA 404)
```

| 层 | 职责 | 代表模块 |
|----|------|------|
| **底层** | `~/.xrk` I/O；诚实响应；按包 surface 持久化 | `underlying/*` · `plugin-surface-store` · `wallet` · `im-channels` · `vision` |
| **Bridge** | 社区契约形状 → XRK 实现 | `host-feature-bridge` · `im-messaging-bridge` · `cordis-fiber-runner` |
| **适配器** | 装配、catch-all、registry | `adapter-compose` · `cordis-registry` |

## 接入层级（A–J）

安装 **产品壳内置 client 之外**的社区包时，按 client 实际 HTTP/RPC 落入下表：

| 层级 | 触发 | Host 行为 |
|------|------|-----------|
| **A** | 仅 Face / 壳 API | 通常可直接使用 |
| **B** | 命中全局能力表 | XRK 底层持久化 |
| **C** | `*-settings` RPC | 设置文档 store |
| **D** | `/_dsh/<pkg>/…` | 通用 JSON；`settings`/`config`/`state` → `~/.xrk/community-surfaces/<id>/` |
| **E** | 单段 slug | `community-root-http` |
| **F** | 其它 GET | 诚实 catch-all |
| **G** | 未注册 POST RPC | settings fallback / 空 ok |
| **H** | `xrk.host.json` | 作者声明 provider |
| **I** | `host.mjs` | 进程内 apply；失败则 **I′** 子进程 |
| **J** | 外部云端 / 厂商发行版 | 可选 sidecar env（IM · 向量库）；`xrkh serve` boot 自动接线 |

## Host 能力

真源：`dsh-compat-matrix.ts`。

| 能力 | 已实现 | 待补 |
|------|--------|------|
| `host.mjs` RPC | inventory · invoke · runHostHalf | 全量第三方 DI（非产品目标） |
| IM | connector · OAuth · `message.send/list` · webhook · poll/SSE · sidecar relay · **in-process WS client** · **本地 WS ingress**（`/api/im/gateway/ws`，无需 `XRK_IM_GATEWAY_*`）；契约包 `@xrkseek/im-gateway-contract`（**非**九路 SDK） | 厂商原生长连接 SDK |
| 任务流 | 持久化 · TS 节点 · scan · `external` 子进程 · **Python bridge**（`XRK_TONGFLOW_PYTHON`） | — |
| GenUI | CRUD · HTML / React tree 预览 · **npm 组件 registry/resolve** · **浏览器 runtime**（`/dsh-genui/runtime.js` mount · CE） | — |
| Vision | paste/analyze · 本地 OCR · OpenAI-compatible · **anthropic-messages** · **gemini-generate** | — |
| 检索与记忆 | 本地 rg · keyword · **`embedding.search` embedded host** · optional `XRK_MEMORY_EMBED_*` sidecar · **Mnemon 文档引擎**（keyword search · mention graph · bodies） | — |
| 自动审阅 | 启发式 classify（默认）· **可替换 classifier**（`options.classifier` / `XRK_AUTO_REVIEW_CLASSIFIER_URL`）· slash | — |
| 上下文浏览器 | Face **`contextTimeline`**（requests 分项 · usage 盖章 · events）/ **`contextHeaders`** · **`costUsage`** 计价 | — |
| 移动访问 | 配对 · LAN/WAN PIN · 隧道 HTTP+WS | — |
| **侧栏（`xrkh-better-sidebar`）** | Host 原生 `createSidebarPublicHandler`（见下节；非 dsh-compat 能力表）；含 `git.worktrees` · `changes.ops` · agent-opens/terminals 真推送 | prefs 默认关；**设置 → 通用** 可开 `agentOpenTools` / `agentTerminalTools`（写 `~/.xrk/sidebar/prefs.json`），开后模型可 `sidebar_open` / `terminal_create` |
| **ModLens（`@liustack/modlens`）** | `GET/POST /modlens/config` · `GET /modlens/paste` → `{ takeover: true }`（关 `pasteToPath` 时 404）· 二进制 `POST /modlens/paste` → `{ path }`；Settings → Plugins 配置卡（`settings.plugin.item` 键 `modlens`；`plugins.bundle.config` 已声明供 inject） | — |
| **牛来桌宠（`dsh-niulai-pet`）** | client `createRoot` 挂 body；Settings 卡 `niulai-pet`；`GET /niulai-kws/*` 白名单伺服 staged `kws/`（装包拷贝资产目录） | 全量 host.mjs Cordis settings 节（桌宠本体不依赖） |
| **皮肤** | `/skin-assets/<id>/<hash>` · `/api/dsh/skins` · `/api/skin-manager` · `/api/skin-center/v2|*` · `/dsh-skin-market` · `/dream-skin/api` · `/wallpaper-engine`；装包拷贝 `assets/` · `preview/` · `locale/` · `skins/` · `skin.json` | Cordis profile 互斥启停区段（XRK 持久化偏好 + 重载；不改写第三方 patch YAML） |

本地消息、节点、OCR 与 GenUI 预览线已在适配器内可用。社区 client 配置卡走 **设置 → Plugins → 插件配置**：Host `describe` 应答后派发全部已注册 `settings.plugin.item` 键（含 Face 未列出的自托管键）。纯 client 包首次安装以及启停 / 删除 / 重载 / 更新后需 **刷新页面**（Desktop 首次装 client 建议整应用重启）才会挂上 / 卸下 `webPlugins`。

## 已适配社区包清单

按下表安装的包，**Host HTTP/RPC 路径已接线**（或纯 client、无 Host 请求）。版本以 npm 当时最新为准；装后执行 `xrkh restart`（或 Settings 提示的刷新）。对照审计：`node scripts/dsh-community-audit.mjs`。

**覆盖说明**：`full` = 审计无缺 HTTP、seat 落在产品壳已声明座位；`host-ok` = Host 路径已覆盖，但仍注册 DSH 全局面板 seat（`sidebar.panellist` / `main` 等）— 见「待补特性」；`client` = 仅壳 UI / Settings 卡，无 Host HTTP。

### 壳 · 工具 · 市场

| npm 包 | 覆盖 | Host 要点 |
|--------|------|-----------|
| `xrkh-better-sidebar` · `dsh-better-sidebar` | full | Host 原生 `/sidebar/*` |
| `dsh-wallet` | full | `/api/wallet` · `/wallet/api` |
| `dsh-memento` | full | `/api/memento` |
| `@liustack/modlens` | full | `/modlens` · paste takeover |
| `@liustack/modsearch` | full | `/modsearch` |
| `dsh-niulai-pet` | full | `/niulai-kws/*` · Settings `niulai-pet` |
| `dsh-genui` | full | `/api/dsh-genui` · `/dsh-genui` · runtime |
| `dsh-tongflow` | full | `/tongflow` · `/api/task` · `/api/plugins` … |
| `dsh-mobile` | full | `/api/mobile-access` · `/mobile-access` |
| `dsh-undo-savepoint` | full | `/api/undo` |
| `dsh-tokenledger` | full | `/api/tokenledger` · `/tokenledger` |
| `dsh-cost-meter` | full | settings RPC · Face cost |
| `@ychris12138/dsh-usage-stats` | full | `/api/usage-stats` |
| `@anionex/dsh-turn-rewind` | full | `/turn-rewind` |
| `dsh-auto-review` | full | `/auto-review` |
| `dsh-whale-girl` | full | community-root · `shell.overlay` |
| `@xmanrui/dsh-im` | full | `/api/im` · IM RPC |
| `dshmarket` | full | `/dsh-market` · install/update/uninstall → `xrkh plugin add`/`remove` |
| `@linxin666/dsh-client-ui-market` | full | Settings · market HTTP |
| `@michengai/dsh-skills-manager` | full | `/api/dsh-skills-manager/state` 扫描工作区/用户 skills · enable/disable/trash/create 持久化 |
| `dsh-chat-import` | full | `/api-import/*` |
| `dsh-vision-router` | full | `/vision-router-settings` · Vision Host |
| `dsh-pocket` | full | `/dsh-pocket` |
| `dsh-plugin-wallpaper-engine` | full | `/wallpaper-engine/*` · `/scene-anim` · `/scene-frame`（占位帧 + progress=100；无 ffmpeg 场景渲染） |
| `dsh-context` | full | `/api/dsh-context/detail` → `{ ok, value }`（session DocStore 可 push）；`balance` · `backfill`；缺 `sidebar.right.pane.*` |
| `dsh-mnemon` | host-ok | Mnemon RPC：documents CRUD · archive/forget · snapshot/capacity/placement · view-settings；缺 panellist / `main` |
| `@linxin666/dsh-client-ui-task-board` | full | `/api/task-board` schemaVersion=3 · `/action` CRUD 持久化 · `/parse` |
| `@linxin666/dsh-ssh` | full | `/api/dsh-ssh/hosts` CRUD 持久化（`~/.xrk/dsh-ssh`）· import `~/.ssh/config`；`/test` TCP 探测；exec/tunnel 诚实无 SSH 引擎；缺 panellist / `main` |
| `@linxin666/dsh-client-ui-git-graph` | host-ok | `/git/*` status · branches · graph · switch · worktrees（真实 git）；缺 `conversation.input.selector.context` |
| `@linxin666/dsh-remote-web-ui` | full | `/api/pair/status|start|claim|…` · `/api/dsh-web-ui-settings` 持久化；`remote.mux` 需 WS；缺 panellist |
| `@linxin666/dsh-web-all` | host-ok | 合集：task-board · ssh · pet · remote · skin-center 等同表路径；`GET /api/update/status` · `POST /api/update/run`（客户端形状；不跑 DSH profile `pnpm update`）；client `require("@deepseek-ai/cordis")` 映射到 `@xrkseek/cordis` 种子；Fluent 图标名（`IconDownloadOutlineRegular` 等）在 `@xrkseek/client-ui-primitives` 上有同字形别名 |
| `@michengai/dsh-automation` | full | `/api/michengai/dsh-automation/update` 探针 · `/tasks` 日程持久化；缺 `sidebar.schedule` seat |
| `@michengai/dsh-codex-ui` | full | `/api/dsh-codex-ui/preferences` 持久化 · `dependencies` 目录；缺 `settings.general.footer` |
| `@michengai/dsh-archive-manager` | full | `/api/michengai/dsh-archive-manager/*` 归档列表持久化 · update 探针 |
| `@michengai/dsh-agency-agents` | full | `/api/michengai/dsh-agency-agents/*` agents 列表持久化 · update 探针 |
| `@michengai/dsh-im-connect` | full | `/api/dsh-im-connect/*` 通道/助手可持久化（离线）；QR/session 需 IM host；缺 `sidebar.channels` |
| `@linxin666/dsh-pet` | full | `/api/pet/state|pets|…` 客户端形状 · `/pet/*` 资产（装包后）· runtime 回落 |
| `dsh-pet` | full | `/dsh-pet-7340/config` GET/PUT/DELETE 持久化 · whisper/chat/balance 诚实离线；另见 `@linxin666/dsh-pet` |
| `dsh-univer-office` | full | `/univer-api/status|gateway|state|…` 离线网关形状（不启进程） |
| `@kenz1117/dsh-ui-usage-billing` | full | `/api/billing/*`（`total` · `source` · `balances` · `quotas` · `enabled`） |
| `dsh-mcp-connector` | full | `POST /mcp-connector/api` 连接目录可 upsert/list |
| `dsh-code-server-app` | full | `/code-server/*` · `/api/code-server/*` 同形离线状态 · `ui-mode` 持久化 · `/ask/state`；进程 start/stop 仍 deferred |
| `@nanmicoder/dsh-agent-teams` | full | `/plugins/dsh-agent-teams/state|plan|halt` 团队目录持久化 |
| `dsh-token-usage-stats` | full | `/token-usage-stats` HTML · `/api/token-usage-stats` JSON |
| `dsh-free-search` | full | `/api/dsh-free-search-settings/{describe,mutate,…}` ns `web-search-free` 持久化；`raw-search` 无钥 `ddg` 走 DuckDuckGo HTML；带 key 引擎仍 deferred |
| `dsh-server-deck` | full | `/server-deck/api/hosts` CRUD · import-ssh-config · metrics/settings；PTY 需 WS |
| `dsh-aimail` | host-ok | 镜像未见独立 pack；见 `dsh-email` |
| `dsh-email` | full | `/_dsh/dsh-email/settings` snapshot/save/serialize/parse 持久化 · whale 占位图；IMAP/SMTP/OAuth dial deferred |
| `@roarpeng/graphflow` | client | `/gf` community-root · MCP 工具面 |
| `@michengai/dsh-btw` | client | `/btw` community-root |
| `@michengai/dsh-codex-pet` | client | `/dsh-codex-pet` community-root |
| `@michengai/dsh-simplify` | client | 斜杠 `/simplify` |
| `@michengai/dsh-code-review` | client | 斜杠 `/review*` |
| `dsh-whale-widget` | client | 费用挂件 |
| `dsh-rewind-plugin` | client | 会话内回退 UI |
| `@linxin666/dsh-client-ui-skill-explorer` | client | Settings 技能中心 UI |
| `dsh-my-guardian` | client | 插件治理 UI |
| `dsh-find-plugin` | client | 会话内找插件（bundle） |
| `billion-context` | client | 上下文压缩 bundle |

### 皮肤 · 主题 · 壁纸

| npm 包 | 覆盖 | Host 要点 |
|--------|------|-----------|
| `@smalltailqwq/dsh-client-ui-skin-maid-atelier` | full | `/skin-assets/maid-atelier/*` · `skin.json` + runtime |
| `@smalltailqwq/dsh-client-ui-skin-orca-link` | full | `/skin-assets/orca-link/*` |
| `@smalltailqwq/dsh-client-ui-skin-deep-whale-manager` | full | `/api/dsh/skins` 目录 · 切换 · 版本探测形状 |
| `dsh-skin-manager` | full | `/api/skin-manager/list` · `/apply` |
| `@linxin666/dsh-client-ui-skin-center` | full | `/api/skin-center/v2/*` · `/we/inventory` · 内置 `skins/` 静态资源 |
| `@linxin666/dsh-skins`（及内嵌 `blue-fantasy` · `dragon-heir` · `harbor` · `maid-atelier` · `matrix` · `miku` · `minecraft` · `trading` · `whale-mom` · `whale-song` · `xp`） | full | 经 skin-center / skin-assets 发现 `skin.json` |
| `dsh-skin-market` | full | `/dsh-skin-market/catalog` · state · activate |
| `dsh-dream-skin` | full | `/dream-skin/api` · Settings `dreamSkin` |
| `dsh-plugin-wallpaper-engine` | full | 见上表「壳 · 工具」 |
| `dsh-client-ui-aqua` | client | Settings `aqua` · body 装饰 |
| `open-sea-skin` | client | body 装饰 |
| `dsh-client-liang-intensity-skin` | client | `conversation.input.right` |

装皮肤包后若立绘 404：确认 staged `assets/` · `skin.json`，并重启 Host。

## 侧栏插件契约（Host 原生，client 只挂 UI）

标准侧栏包 **`xrkh-better-sidebar`**（`kind: client`，建议 **≥ 0.18.22**）注入 `lib/client.js`。`/sidebar/*` 由 Host `createSidebarPublicHandler` 挂载；插件 host 半包不占用该路径。

概况栏（`details`）默认 **Status**（子代理图 · jobs · live `contextTimeline` · cost · channels），与 `/status` / Face `session.status` 同源。概况栏与侧栏工作台可同时开：壳发布 `LayoutInsets`（`--xrk-layout-inset-*`）。产品切分见 [sidebar-workbench](./sidebar-workbench.md)。

产品 Host 挂载同源 `/sidebar/*`，再经 `attachSidebarPtyUpgrades` 挂终端 WS。社区 client 若也调 `/sidebar/*`，共用同一契约。

| 表面 | Host 落点 | 插件职责 |
|------|-----------|----------|
| `POST /sidebar/api/<method>` | `packages/server/http/src/sidebar/`（FS · git · prefs · shell · browser · **jobs** · **subagents.live** · **subagents.graph**（view / link / unlink / role / remove）· **changes.ops** · **open.external**） | 调 API；client 里不重复实现 Host |
| `/sidebar/file` · `upload` · `html` · `bundle` | 同上 + 插件目录 `chunks/` | 发布 `lib/client-*.js` 供 bundle 回落 |
| `/sidebar/ws/terminal` | Host `sidebar-pty`（真实 node-pty · session+tab 保活；系统用户权限，**不**套 Agent sandbox / fence） | TerminalView 连同源 WS |
| `/sidebar/ws/agent-terminals` · `agent-opens` | Host 真推送（registry + prefs 门控工具；Settings → 通用开关）；无 registry 时仍空列表保活 | 推送由 Host 提供；插件 host 半包不实现 |
| Face 注入 `sidebarFace` | Host：`openExternal` · jobs · `listSubagentsLive` · rewind `forkSessionAt` | 子代理 / 后台任务 / 外开路径走此桥 |

`subagents.live` 的 wire 形状为嵌套 `tool`：`{ text?; tool?: { name; args } }`（与插件 `LastActivity` / `SidebarSubagentLiveActivity` 一致）。Host 真源：`packages/server/host/src/sidebar-live-line.ts`。

活跃判定走 `isChildSessionActive`（drain latch active **或** 外部代理 acp / app-server 忙），与 Overview 委派图**共用同一谓词**；只判 `drain.isActive` 会让 ACP / app-server 子代理恒显已完成。信号不变量见 [session-latch.md](./session-latch.md)。

预览契约（先类型、后 UI）：`@xrkseek/protocol` 的 `BrowserEmbedProbe` · `SubagentPreviewSummary` · `PlanPreviewSummary` · `OfficePreviewStatus`；policy 边界 `host.open` · `sidebar.embed` · `sidebar.fs` · `office.connect`（见 [policy](./policy.md)）。**Office 状态仍走 `/office`**（`office.connect` 已门禁 mutation），不挂到 `/sidebar`。计划全文读 Face `plan` 投影；侧栏只消费摘要。

**已移除**：Side Chat（beta）及 Host `sidechat.*`。子代理与后台任务请用 Face `subagent.*` + Sidebar `subagents.live` / `jobs.*`。

扩展新 sidebar RPC：扩 `sidebar-adapter` /（需要 Face 时）`SidebarFaceBridge`。`/sidebar/*` 不并入 dsh-compat 能力表。

## 回归 fixture

`packages/server/http/tests/fixtures/compat-host-suite.json` 是测例清单；可安装列表以本页「已适配」为准。

## 待补特性

真源：`dsh-compat-matrix.ts` 的 `DSH_COMPAT_KNOWN_GAPS`：

| id | 覆盖 | 形状 |
| --- | --- | --- |
| `web-panel-global-registry` | missing | DSH 全局面板 seat `sidebar.panellist` / `main` 在 XRK 壳无落点 |
| `cordis-dual-half-inspect` | honest-stub | 不嵌入第三方 Host 内核；fiber fallback 保持 apply 驱动 |
| `third-party-di` | honest-stub | 未知 service 回诚实 envelope |

TongFlow 装包：`POST /tongflow/plugins` → `runPluginMutate`（`xrkh plugin add`）。装后 `xrkh restart`。

`dshmarket`：`POST /dsh-market/install|update|uninstall` → `runPluginMutate`（catalog `url`→`npm`）；`GET /dsh-market/updates` 回 `{}`。备份 / 频道 / 批准构建等维护动作仍 CLI 推迟。

## 官方捆绑 ↔ 产品内置

| DSH 官方卡 | XRK 落点 |
|------------|----------|
| 智能体团队 | Face `agentTeams` · Status 任务板 · `team_graph` |
| 自动授权审查 | Settings Auto-review · `/auto-review`（社区 `dsh-auto-review` 同表） |
| 语音输入 | Settings → Voice · `voice_transcribe`（SenseVoice 本地模型 / 唤醒词未做） |
| 终端 | Sidebar `/sidebar/ws/terminal` · Settings shell |
| Agent Loop | Settings → agent-loop |
| 子代理 | Face `subagent.*` · Sidebar live |
| 网页搜索 | Settings → web-search · `exec-web` |

## 可选外接 env（不进仓依赖）

联调自运维 sidecar 时使用；Host 核心不嵌入这些服务。

| 变量 | 用途 |
| --- | --- |
| `XRK_IM_GATEWAY_URL` | 外接 IM relay 基址（HTTP health + WS `/ws` 推导） |
| `XRK_IM_GATEWAY_WS_URL` | 显式 IM WebSocket 网关地址（优先于 URL 推导） |
| `XRK_IM_GATEWAY_TOKEN` | relay / WS 鉴权 Bearer |
| `XRK_MEMORY_EMBED_URL` | 外接向量库 HTTP 基址（如 Qdrant REST）；未接时仍走本地 hash bridge；亦可 Settings → Plugins → 高级 |
| `XRK_MEMORY_EMBED_TOKEN` | 向量库 API key（可选；Credentials / 高级卡） |
| `XRK_MEMORY_EMBED_COLLECTION` | 集合 / index 名（可选；亦可 Settings `memory-embed.collection`） |
| `XRK_AUTO_REVIEW_CLASSIFIER_URL` | 外接 auto-review classifier（POST；未设则启发式；亦可 Settings → Plugins → 高级） |
| `XRK_AUTO_REVIEW_CLASSIFIER_TOKEN` | classifier Bearer（可选；Credentials / 高级卡） |
| `XRK_GENUI_NPM_ALLOWLIST` | 逗号分隔 npm 包名，合并进 GenUI component registry |
| `XRK_TONGFLOW_PYTHON` | 用户 Python 解释器（scan / `kind:python` 节点） |
| `XRK_TONGFLOW_PYTHON_SCAN` | 自定义 `/tongflow/scan` 脚本路径 |
| `XRK_TONGFLOW_PYTHON_RUNNER` | 自定义 Python 节点 runner 脚本 |

Sidecar 契约：`@xrkseek/im-gateway-contract` · `im-gateway-sidecar.ts` · [im-gateway-sidecar.md](./im-gateway-sidecar.md) · `memory-embeddings.ts` · [ADR-0006](./adr/0006-im-long-lived-gateway.md)。

## 本地审计

```bash
node scripts/dsh-community-audit.mjs
# 本机镜像 awesome 目录（便于搜 client.js / HTTP，可 resume）
node scripts/dsh-community-mirror.mjs              # → ~/.xrk/community-plugin-mirror
node scripts/dsh-community-mirror.mjs --search=skin
```

对照 client 扫描路径与能力表；未入表路径仍返回诚实 JSON。

## Face：`dynamicCordisRunner/*`

面板经 Face RPC 驱动适配器（**不是**产品 SPA `boot.json` 条目；Cordis UI/runner 客户端包已从产品 boot 剥离）。

| 方法 | 行为 |
|------|------|
| `inventory` · `getClientCode` · `runHostHalf` | 适配器 + 可选子进程 |
| `invoke` | registry / 子进程 RPC |
| `stopFromPanel` | 停止子进程 + ack |

见 [host-face.md](./host-face.md)。

## 相关

[status.md](./status.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)

---

# Community Plugins and Host Contracts

> **Audience**: Integrators · Contributors (install community clients; compare implemented Host surfaces and planned work)

The product shell may load community `client.js`. The Host side is wired by the built-in adapter `extensions/dsh-compat` and `@xrkseek/server-http/dsh-compat` according to **path and RPC shape**, with persistence under `~/.xrk`. Implementation notes: [dsh-compat/README.md](../packages/server/http/src/dsh-compat/README.md) · Package boundary: [PACKAGE.md](../packages/server/http/src/dsh-compat/PACKAGE.md) · Discover: [plugin-loader.md](./plugin-loader.md).

## Install and use

1. Start with a workspace: `npx @xrkseek/harness-cli web` (or source `xrkh web`).
2. Install a community client package into the user plugin directory — CLI or **Settings → Plugins → Plugin list** install field (`pluginInventory/install`, same path as `xrkh plugin add`):

```bash
xrkh plugin add <package-name>
xrkh restart
```

Example package names: `dsh-wallet` · `@liustack/modsearch` · `xrkh-better-sidebar` · `@smalltailqwq/dsh-client-ui-skin-maid-atelier` (full inventory under **Adapted community packages** below). After CLI install use **`xrkh restart`**; Settings install live-reconciles the process half — hard-refresh the client half when the list shows `needsRestart`.

3. Prefer **Settings → Plugins** (plugin list + each plugin’s config card) for install / update / disable / delete and day-to-day toggles; use env / on-disk files for Host/CI headless runs.
4. `xrk.host.json` is optional: the loader uses the capability table + `client.js` scan + convention infer ([plugin-loader.md](./plugin-loader.md)). Authors may still declare `xrk.host.json` or ship `host.mjs`.
5. What works vs what is planned follows **Host capabilities** below and [status.md](./status.md).

## Architecture

```text
community client.js
    → Face wire or same-origin HTTP / RPC
        → capability table + XRK underlying (~/.xrk)
        → bridge (XRK impl / optional subprocess apply)
        → unlisted paths: honest JSON (not SPA 404)
```

| Layer | Responsibility | Modules |
|----|------|------|
| **Underlying** | `~/.xrk` I/O; honest responses; per-plugin surface persist | `underlying/*` · `plugin-surface-store` · `wallet` · `im-channels` · `vision` |
| **Bridge** | Community contract shape → XRK implementation | `host-feature-bridge` · `im-messaging-bridge` · `cordis-fiber-runner` |
| **Adapter** | Composition, catch-all, registry | `adapter-compose` · `cordis-registry` |

## Integration tiers (A–J)

When installing community packages **beyond the product-shell built-in clients**, map each package by its actual HTTP/RPC surface:

| Tier | Trigger | Host behavior |
|------|------|-----------|
| **A** | Face / shell API only | Usually works as-is |
| **B** | Hits global capability table | First-party persistence |
| **C** | `*-settings` RPC | Settings document store |
| **D** | `/_dsh/<pkg>/…` | Generic JSON; `settings`/`config`/`state` → `~/.xrk/community-surfaces/<id>/` |
| **E** | Single-segment slug | `community-root-http` |
| **F** | Other GET | Honest catch-all |
| **G** | Unregistered POST RPC | Settings fallback / empty ok |
| **H** | `xrk.host.json` | Author-declared provider |
| **I** | `host.mjs` | In-process apply; on failure **I′** subprocess |
| **J** | External cloud / vendor distribution | Optional sidecar env (IM · vectors); wired on `xrkh serve` boot |

## Host capabilities

Source of truth: `dsh-compat-matrix.ts`.

| Capability | Implemented | Planned |
|------|--------|------|
| `host.mjs` RPC | inventory · invoke · runHostHalf | Full third-party DI (out of scope) |
| IM | connector · OAuth · `message.send/list` · webhook · poll/SSE · sidecar relay · **in-process WS client** · **local WS ingress** (`/api/im/gateway/ws`, no `XRK_IM_GATEWAY_*` required); contract package `@xrkseek/im-gateway-contract` (**not** a nine-vendor SDK) | Vendor-native long-lived SDKs |
| Task flow | Persistence · TS nodes · scan · `external` subprocess · **Python bridge** (`XRK_TONGFLOW_PYTHON`) | — |
| GenUI | CRUD · HTML / React tree preview · **npm component registry/resolve** · **browser runtime** (`/dsh-genui/runtime.js` mount · CE) | — |
| Vision | paste/analyze · local OCR · OpenAI-compatible · **anthropic-messages** · **gemini-generate** | — |
| Search & memory | Local rg · keyword · **`embedding.search` embedded host** · optional `XRK_MEMORY_EMBED_*` sidecar · **Mnemon document engine** (keyword search · mention graph · bodies) | — |
| Auto-review | Heuristic classify (default) · **replaceable classifier** (`options.classifier` / `XRK_AUTO_REVIEW_CLASSIFIER_URL`) · slash | — |
| Context browser | Face **`contextTimeline`** (per-request items · usage stamps · events) / **`contextHeaders`** · **`costUsage`** pricing | — |
| Mobile access | Pairing · LAN/WAN PIN · tunnel HTTP+WS | — |
| **Sidebar (`xrkh-better-sidebar`)** | Host owns `/sidebar/*` (see below); includes `git.worktrees` · `changes.ops` · real agent-opens/terminals push | Prefs default off; **Settings → General** toggles `agentOpenTools` / `agentTerminalTools` (`~/.xrk/sidebar/prefs.json`); then model may `sidebar_open` / `terminal_create` |
| **ModLens (`@liustack/modlens`)** | `GET/POST /modlens/config` · `GET /modlens/paste` → `{ takeover: true }` (404 when `pasteToPath` off) · binary `POST /modlens/paste` → `{ path }`; Settings → Plugins config card (`settings.plugin.item` key `modlens`; `plugins.bundle.config` declared for inject) | — |
| **Niulai pet (`dsh-niulai-pet`)** | client `createRoot` on `document.body`; Settings card `niulai-pet`; `GET /niulai-kws/*` allowlist serves staged `kws/` (install copies asset dirs) | Full Cordis host settings section (pet UI does not require it) |
| **Skins** | `/skin-assets/<id>/<hash>` · `/api/dsh/skins` · `/api/skin-manager` · `/api/skin-center/v2|*` · `/dsh-skin-market` · `/dream-skin/api` · `/wallpaper-engine`; install stages `assets/` · `preview/` · `locale/` · `skins/` · `skin.json` | Cordis exclusive profile patch blocks (XRK stores preference + reload; does not rewrite third-party patch YAML) |

Local messaging, nodes, OCR, and GenUI preview are available inside the adapter today. Community config cards render under **Settings → Plugins → Configurable** after one Host `describe`: every registered `settings.plugin.item` key is dispatched (including self-hosted keys Face never lists). After install **and** enable / disable / delete / reload / update, **refresh the page** so client halves remount (Desktop first install of a pure client package: prefer a full app restart).

## Adapted community packages

Packages in the tables below have **Host HTTP/RPC wired** (or are client-only with no Host calls). Use current npm versions; after install run `xrkh restart` (or refresh when Settings prompts). Audit: `node scripts/dsh-community-audit.mjs`.

**Coverage**: `full` = no missing HTTP and seats land on product-shell seats; `host-ok` = Host paths covered, but the client still registers DSH global-panel seats (`sidebar.panellist` / `main`, …) — see **Planned work**; `client` = shell UI / Settings only, no Host HTTP.

### Shell · tools · market

| npm package | Coverage | Host surface |
|--------|------|-----------|
| `xrkh-better-sidebar` · `dsh-better-sidebar` | full | Host-native `/sidebar/*` |
| `dsh-wallet` | full | `/api/wallet` · `/wallet/api` |
| `dsh-memento` | full | `/api/memento` |
| `@liustack/modlens` | full | `/modlens` · paste takeover |
| `@liustack/modsearch` | full | `/modsearch` |
| `dsh-niulai-pet` | full | `/niulai-kws/*` · Settings `niulai-pet` |
| `dsh-genui` | full | `/api/dsh-genui` · `/dsh-genui` · runtime |
| `dsh-tongflow` | full | `/tongflow` · `/api/task` · `/api/plugins` … |
| `dsh-mobile` | full | `/api/mobile-access` · `/mobile-access` |
| `dsh-undo-savepoint` | full | `/api/undo` |
| `dsh-tokenledger` | full | `/api/tokenledger` · `/tokenledger` |
| `dsh-cost-meter` | full | settings RPC · Face cost |
| `@ychris12138/dsh-usage-stats` | full | `/api/usage-stats` |
| `@anionex/dsh-turn-rewind` | full | `/turn-rewind` |
| `dsh-auto-review` | full | `/auto-review` |
| `dsh-whale-girl` | full | community-root · `shell.overlay` |
| `@xmanrui/dsh-im` | full | `/api/im` · IM RPC |
| `dshmarket` | full | `/dsh-market` · install/update/uninstall → `xrkh plugin add`/`remove` |
| `@linxin666/dsh-client-ui-market` | full | Settings · market HTTP |
| `@michengai/dsh-skills-manager` | full | `/api/dsh-skills-manager/state` scans workspace/user skills · enable/disable/trash/create persisted |
| `dsh-chat-import` | full | `/api-import/*` |
| `dsh-vision-router` | full | `/vision-router-settings` · Vision host |
| `dsh-pocket` | full | `/dsh-pocket` |
| `dsh-plugin-wallpaper-engine` | full | `/wallpaper-engine/*` · `/scene-anim` · `/scene-frame` (placeholder frame + progress=100; no ffmpeg scene render) |
| `dsh-context` | full | `/api/dsh-context/detail` → `{ ok, value }` (session DocStore push); `balance` · `backfill`; missing `sidebar.right.pane.*` |
| `dsh-mnemon` | host-ok | Mnemon RPC: documents CRUD · archive/forget · snapshot/capacity/placement · view-settings; missing panellist / `main` |
| `@linxin666/dsh-client-ui-task-board` | full | `/api/task-board` schemaVersion=3 · `/action` CRUD persisted · `/parse` |
| `@linxin666/dsh-ssh` | full | `/api/dsh-ssh/hosts` CRUD persisted (`~/.xrk/dsh-ssh`) · import `~/.ssh/config`; `/test` TCP probe; exec/tunnel honest without SSH engine; missing panellist / `main` |
| `@linxin666/dsh-client-ui-git-graph` | host-ok | `/git/*` status · branches · graph · switch · worktrees (real git); missing `conversation.input.selector.context` |
| `@linxin666/dsh-remote-web-ui` | full | `/api/pair/status|start|claim|…` · `/api/dsh-web-ui-settings` persisted; `remote.mux` needs WS; missing panellist |
| `@linxin666/dsh-web-all` | host-ok | Bundle: task-board · ssh · pet · remote · skin-center (same paths as above); `GET /api/update/status` · `POST /api/update/run` (client-shaped; no DSH profile `pnpm update`); client `require("@deepseek-ai/cordis")` remaps onto the `@xrkseek/cordis` seed; Fluent icon ids (`IconDownloadOutlineRegular`, …) are aliased on `@xrkseek/client-ui-primitives` |
| `@michengai/dsh-automation` | full | `/api/michengai/dsh-automation/update` probe · `/tasks` schedule persisted; missing `sidebar.schedule` seat |
| `@michengai/dsh-codex-ui` | full | `/api/dsh-codex-ui/preferences` persisted · `dependencies` catalog; missing `settings.general.footer` |
| `@michengai/dsh-archive-manager` | full | `/api/michengai/dsh-archive-manager/*` archive list persisted · update probe |
| `@michengai/dsh-agency-agents` | full | `/api/michengai/dsh-agency-agents/*` agents list persisted · update probe |
| `@michengai/dsh-im-connect` | full | `/api/dsh-im-connect/*` channels/assistant persist (offline); QR/session need IM host; missing `sidebar.channels` |
| `@linxin666/dsh-pet` | full | `/api/pet/state|pets|…` client shapes · `/pet/*` assets (when staged) · runtime fallback |
| `dsh-pet` | full | `/dsh-pet-7340/config` GET/PUT/DELETE persist · whisper/chat/balance honest offline; see also `@linxin666/dsh-pet` |
| `dsh-univer-office` | full | `/univer-api/status|gateway|state|…` offline gateway shapes (no process start) |
| `@kenz1117/dsh-ui-usage-billing` | full | `/api/billing/*` (`total` · `source` · `balances` · `quotas` · `enabled`) |
| `dsh-mcp-connector` | full | `POST /mcp-connector/api` connection catalog upsert/list |
| `dsh-code-server-app` | full | `/code-server/*` · `/api/code-server/*` same offline shape · `ui-mode` persist · `/ask/state`; process start/stop still deferred |
| `@nanmicoder/dsh-agent-teams` | full | `/plugins/dsh-agent-teams/state|plan|halt` team catalog persisted |
| `dsh-token-usage-stats` | full | `/token-usage-stats` HTML · `/api/token-usage-stats` JSON |
| `dsh-free-search` | full | `/api/dsh-free-search-settings/{describe,mutate,…}` ns `web-search-free` persist; keyless `ddg` `raw-search` via DuckDuckGo HTML; keyed engines still deferred |
| `dsh-server-deck` | full | `/server-deck/api/hosts` CRUD · import-ssh-config · metrics/settings; PTY needs WS |
| `dsh-aimail` | host-ok | no separate pack in mirror; see `dsh-email` |
| `dsh-email` | full | `/_dsh/dsh-email/settings` snapshot/save/serialize/parse persist · whale placeholder; IMAP/SMTP/OAuth dial deferred |
| `@roarpeng/graphflow` | client | `/gf` community-root · MCP tools |
| `@michengai/dsh-btw` | client | `/btw` community-root |
| `@michengai/dsh-codex-pet` | client | `/dsh-codex-pet` community-root |
| `@michengai/dsh-simplify` | client | slash `/simplify` |
| `@michengai/dsh-code-review` | client | slash `/review*` |
| `dsh-whale-widget` | client | cost widget |
| `dsh-rewind-plugin` | client | in-session rewind UI |
| `@linxin666/dsh-client-ui-skill-explorer` | client | Settings skill center UI |
| `dsh-my-guardian` | client | plugin-governance UI |
| `dsh-find-plugin` | client | in-session plugin finder (bundle) |
| `billion-context` | client | context-compaction bundle |

### Skins · themes · wallpaper

| npm package | Coverage | Host surface |
|--------|------|-----------|
| `@smalltailqwq/dsh-client-ui-skin-maid-atelier` | full | `/skin-assets/maid-atelier/*` · `skin.json` + runtime |
| `@smalltailqwq/dsh-client-ui-skin-orca-link` | full | `/skin-assets/orca-link/*` |
| `@smalltailqwq/dsh-client-ui-skin-deep-whale-manager` | full | `/api/dsh/skins` catalog · switch · version-probe shape |
| `dsh-skin-manager` | full | `/api/skin-manager/list` · `/apply` |
| `@linxin666/dsh-client-ui-skin-center` | full | `/api/skin-center/v2/*` · `/we/inventory` · bundled `skins/` assets |
| `@linxin666/dsh-skins` (nested `blue-fantasy` · `dragon-heir` · `harbor` · `maid-atelier` · `matrix` · `miku` · `minecraft` · `trading` · `whale-mom` · `whale-song` · `xp`) | full | discovered via skin-center / skin-assets `skin.json` |
| `dsh-skin-market` | full | `/dsh-skin-market/catalog` · state · activate |
| `dsh-dream-skin` | full | `/dream-skin/api` · Settings `dreamSkin` |
| `dsh-plugin-wallpaper-engine` | full | see Shell · tools table above |
| `dsh-client-ui-aqua` | client | Settings `aqua` · body décor |
| `open-sea-skin` | client | body décor |
| `dsh-client-liang-intensity-skin` | client | `conversation.input.right` |

If skin artwork 404s after install: confirm staged `assets/` · `skin.json`, then restart Host.

## Sidebar plugin contract (Host owns; client UI only)

Standard sidebar package **`xrkh-better-sidebar`** (`kind: client`, prefer **≥ 0.18.22**) injects `lib/client.js`. `/sidebar/*` is mounted by Host `createSidebarPublicHandler`; a plugin host half does not occupy that path.

The session **Status** column (`details`) defaults to the subagent graph · jobs · live `contextTimeline` · cost · channels (same source as `/status` / Face `session.status`). Status and the sidebar workbench may stay open together via `LayoutInsets` (`--xrk-layout-inset-*`). Product cut: [sidebar-workbench](./sidebar-workbench.md).

Product Host mounts same-origin `/sidebar/*`, then `attachSidebarPtyUpgrades` for terminal WS. Community clients that call `/sidebar/*` share the same contract.

| Surface | Host landing | Plugin role |
|------|-----------|----------|
| `POST /sidebar/api/<method>` | `packages/server/http/src/sidebar/` (FS · git · prefs · shell · browser · **jobs** · **subagents.live** · **subagents.graph** · **changes.ops** · **open.external**) | Call the API |
| `/sidebar/file` · `upload` · `html` · `bundle` | same + plugin `chunks/` | Ship `lib/client-*.js` for bundle fallback |
| `/sidebar/ws/terminal` | Host `sidebar-pty` (real node-pty · session+tab reuse) | TerminalView same-origin WS |
| `/sidebar/ws/agent-terminals` · `agent-opens` | Host push (registry + prefs; Settings → General) | Host provides push |
| Face inject `sidebarFace` | `openExternal` · jobs · `listSubagentsLive` · `forkSessionAt` | Subagents / jobs / reveal-path |

`subagents.live` wire: `{ text?; tool?: { name; args } }`. Host: `packages/server/host/src/sidebar-live-line.ts`.

Activity uses `isChildSessionActive` (drain latch active **or** external acp / app-server agent busy) — the **same predicate** as the Overview delegation board. A drain-only check pins every ACP / app-server child to completed. Signal invariants: [session-latch.md](./session-latch.md).

Preview types: `@xrkseek/protocol` `BrowserEmbedProbe` · `SubagentPreviewSummary` · `PlanPreviewSummary` · `OfficePreviewStatus`; policy `host.open` · `sidebar.embed` · `sidebar.fs` · `office.connect` ([policy](./policy.md)). Office status stays on `/office`. Plan bodies come from Face `plan`; sidebar consumes summaries.

**Removed:** Side Chat / `sidechat.*`. Use Face `subagent.*` + Sidebar `subagents.live` / `jobs.*`.

To add sidebar RPC: extend `sidebar-adapter` / (when Face is needed) `SidebarFaceBridge`. `/sidebar/*` is not merged into the dsh-compat capability table.

## Regression fixtures

`packages/server/http/tests/fixtures/compat-host-suite.json` is a regression inventory; the installable set is the **Adapted** tables above.

## Planned work

Truth source: `DSH_COMPAT_KNOWN_GAPS` in `dsh-compat-matrix.ts`:

| id | coverage | shape |
| --- | --- | --- |
| `web-panel-global-registry` | missing | DSH global-panel seats `sidebar.panellist` / `main` have no XRK shell landing |
| `cordis-dual-half-inspect` | honest-stub | No third-party Host kernel embed; fiber fallback stays apply-driven |
| `third-party-di` | honest-stub | Unknown services get an honest envelope |

TongFlow install: `POST /tongflow/plugins` → `runPluginMutate` (`xrkh plugin add`). Then `xrkh restart`.

`dshmarket`: `POST /dsh-market/install|update|uninstall` → `runPluginMutate` (catalog `url`→`npm`); `GET /dsh-market/updates` returns `{}`. Backup / channel / approve-builds stay CLI-deferred.

## Official bundled ↔ first-party

| DSH official card | XRK landing |
|-------------------|-------------|
| Agent Teams | Face `agentTeams` · Status task board · `team_graph` |
| Auto authorization review | Settings Auto-review · `/auto-review` (community `dsh-auto-review` in the table above) |
| Voice input | Settings → Voice · `voice_transcribe` (SenseVoice local model / wake word not shipped) |
| Terminal | Sidebar `/sidebar/ws/terminal` · Settings shell |
| Agent Loop | Settings → agent-loop |
| Sub-Agent | Face `subagent.*` · Sidebar live |
| Web search | Settings → web-search · `exec-web` |

## Optional external env (not in-repo dependencies)

For self-hosted sidecars; Host core does not embed these services.

| Variable | Purpose |
| --- | --- |
| `XRK_IM_GATEWAY_URL` | External IM relay base (HTTP health; WS `/ws` inferred) |
| `XRK_IM_GATEWAY_WS_URL` | Explicit IM WebSocket gateway URL (overrides inference) |
| `XRK_IM_GATEWAY_TOKEN` | Bearer for relay / WS auth |
| `XRK_MEMORY_EMBED_URL` | External vector DB HTTP base (e.g. Qdrant REST); local hash bridge when unset; also Settings → Plugins → Advanced |
| `XRK_MEMORY_EMBED_TOKEN` | Vector DB API key (optional; Credentials / Advanced card) |
| `XRK_MEMORY_EMBED_COLLECTION` | Collection / index name (optional; also Settings `memory-embed.collection`) |
| `XRK_AUTO_REVIEW_CLASSIFIER_URL` | External auto-review classifier (POST; heuristic when unset; also Settings → Plugins → Advanced) |
| `XRK_AUTO_REVIEW_CLASSIFIER_TOKEN` | Classifier Bearer (optional; Credentials / Advanced card) |
| `XRK_GENUI_NPM_ALLOWLIST` | Comma-separated npm packages merged into GenUI registry |
| `XRK_TONGFLOW_PYTHON` | User Python interpreter (scan / `kind:python` nodes) |
| `XRK_TONGFLOW_PYTHON_SCAN` | Custom `/tongflow/scan` script path |
| `XRK_TONGFLOW_PYTHON_RUNNER` | Custom Python node runner script |

Sidecar contracts: `@xrkseek/im-gateway-contract` · `im-gateway-sidecar.ts` · [im-gateway-sidecar.md](./im-gateway-sidecar.md) · `memory-embeddings.ts` · [ADR-0006](./adr/0006-im-long-lived-gateway.md).

## Local audit

```bash
node scripts/dsh-community-audit.mjs
# Local awesome catalog mirror (searchable client.js / HTTP; resumable)
node scripts/dsh-community-mirror.mjs              # → ~/.xrk/community-plugin-mirror
node scripts/dsh-community-mirror.mjs --search=skin
```

Compare scanned client paths with the capability table; unlisted paths still return honest JSON.

## Face: `dynamicCordisRunner/*`

The panel drives the adapter via Face RPC (**not** product SPA `boot.json` entries; Cordis UI/runner client packages are stripped from product boot).

| Method | Behavior |
|------|------|
| `inventory` · `getClientCode` · `runHostHalf` | Adapter + optional subprocess |
| `invoke` | Registry / subprocess RPC |
| `stopFromPanel` | Stop subprocess + ack |

See [host-face.md](./host-face.md).

## Related

[status.md](./status.md) · [plugin-loader.md](./plugin-loader.md) · [host-face.md](./host-face.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)
