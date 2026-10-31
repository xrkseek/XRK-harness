# 社区插件兼容矩阵（XRK Host bridge）

> **读者**：集成者 · 维护者（对照社区 client 期望与 Host 实际服务面）

写法对标 DSH 对 Claude Code mods 的兼容页：每一行写清**对方行为**、**本桥接做法**、**原因或后续**。未列出的路径走诚实 catch-all，不假装完整实现。

矩阵真源随代码：`packages/server/http/src/dsh-compat/`。能力总表仍见 [community-plugins.md](./community-plugins.md) · [status.md](./status.md)。

---

## 共通底层（所有社区包）

| 对方（DSH / 社区） | 本桥接 | 原因或后续 |
|---|---|---|
| boot 图 id = `package.json` name；`__ModuleLoader__.load({ id })` 必须同名 | 安装 / `serve` reconcile 对齐同族 stamp（裸名 ↔ `@scope/裸名`）；运行时 ModuleLoader 按 boot 图族双登记（并行 prefetch 不依赖单槽 `executingId`）；仅当 stamp 与任何图行都不同族时拒为 mis-stamped | 社区常以裸名注册、scoped 再发行；并行 `async` 脚本曾误伤 OFM 等包；见 `plugin-package-id` · `client-modules` · CLI `alignClientModuleLoaderId` / `realignStagedClientModuleLoaderIds` |
| Cordis `inject: ['webServer']` + `webServer.register` | Host apply 贡献经 `pushCordisWebServerRoute` 先于 baseline 入册（首匹配胜） | OFM / WorkBuddy 已走此路；wallpaper 整包 Cordis apply（含 `cordis.patch.yml` 子包）仍待 |
| 具名 Host 半（`lib/index.js` / 根 `index.js`） | **装包**：有根 `index.js` 就拷（+ 存在的 `src`/`adapter`/`vendor`/`locale`），不按 publisher 名单；WorkBuddy 仍拷 `lib/`。**愈合**：`package.json` 声明根 `index.js` 但盘上缺失时 reconcile 才 `npm pack` 补（健康路径只 stat）。**Apply** 仍按裸名族。**Catch-all**：默认 `ok:false`/`incomplete`；已知 Settings 硬依赖数组的 **URL 前缀**（非包名）在 `incomplete-api-shapes` 给空数组 | 社区 scoped 再发行多；勿按包名堆适配器；缺 Host 半时假 `ready` 会让面板 `.filter` 崩 |
| `require('@deepseek-ai/dsh-client-*')` | 浏览器 `remapDshClientRequire` → `@xrkseek/client-*`；Host `ensureHostModuleRemap` | 构建期 / 运行时两层 |

### DOM / CSS 样式命名（client 壳双戳）

真源：`packages/client/ui-layout/src/client/dsh-style-aliases.ts` + 各 stamp 位点。XRK 自有 `--xrk-*` / `data-xrk-*`；社区 CSS 仍读 DSH 名时**同值双写**，不改产品语义。

| 对方（DSH） | 本桥接 | 等级 |
|---|---|---|
| `html[data-windows-titlebar]` + `--dsh-windows-titlebar-height` / `--dsh-frame-{top-clearance,chrome-top,overlay-top}` | Desktop chrome 时 `applyDesktopChromeDomAliases` 写到 `<html>`；frame CSS 亦镜像 | full |
| `html[data-ds-theme-source]` · `--dsh-content-font-size` · `--dsh-code-font-size` · `--dsh-terminal-font-size` | ThemePresenter 写 source；三字号轴镜像同一 content 字号（本仓 Settings 只有一档） | full（字号轴 degraded 合并） |
| `[data-dsh-frame]` · `[data-pane=conversation]` · `[data-panel-conversation]` · `[data-shell-overlay]` | AppFrame 已 stamp（panel-conversation = pane 别名） | full |
| `[data-sidebar-right-panel]` · `[data-sidebar-right-open]` · `[data-rightbar-col]` · `[data-rightbar-collapsed]` | details 列双戳；frame 上 rightbar-collapsed ≡ detailsCollapsed | full（形态：details ≡ 旧 rightbar） |
| `[data-dsh-boot]` · `[data-dsh-boot-spinner]` · `html[data-dsh-booting]` | AppRoot splash + boot-stamp 双戳 | full |
| `[data-content-phase]` · `[data-conversation-content]` · `[data-conversation-session]` · `[data-conversation-region=composer]` | ConversationRoot / composer seat | full |
| `[data-message-bubble]` · `[data-turn-trigger]` · `[data-turn-process]` | MessageItem · ReasoningRow · ProcessGroupSeat | full |
| `[data-disclosure-header]` · `[data-disclosure-row]` | DisclosureRow 外层 header + row（maid think/tool） | full |
| `[data-shortcut-modal=settings\|shortcuts]` | SettingsRoot · ShortcutsPanel→Modal | full |
| `[data-animating]` · `[data-shell-leading]` | AppFrame 折叠过渡闸 + 收起侧栏 chrome 座 | full |
| `[data-conversation-header-leading]` · `[data-conversation-tabs]` | ConversationSessionHeader | full |
| `[data-cordis-approve]` · `[data-cordis-decline]` | ApprovalPanel 允许/拒绝按钮 | full |
| `--dsh-chat-content-width` · `--dsh-composer-*` · `--dsh-width-handle-pointer-y` · `--dsh-scrollbar-width` | ConversationRoot / scrollbar.css 已发布 | full |
| `--dsh-windows-content-radius` | Desktop chrome frame 默认 16px | full |
| `--dsw-menu-surface-fill` · `--dsw-menu-backdrop-filter` · `--dsw-specific-menu` | design-platform / gradient-shadow-text；主题可重绑 surface-fill | full |
| `--dsw-elevation-{stroke,panel,prominent,soft}` · `--dsw-elevation-stroke-color` | gradient-shadow-text（逐元素派生，菜单深色用 border-l3） | full |
| `--dsw-alias-label-shimmer` · `--dsw-alias-label-deep-diving(-shimmer)` · `--dsw-alias-menu-icon` · `--dsw-alias-state-idle-primary` · `--dsw-alias-toast-label` · `--dsw-alias-tooltip-key-bg` · `--dsw-alias-turn-trigger-bg(-hover)` | design-platform 明/暗双表 | full |
| `ctx.configForms`（DSH 0.1.7+ 主题偏好） | `ui-settings` 薄别名 → `settingsScope`；`describe.ensure` / `whileServed`；Host 对未知 ns mutate → `settings.yaml` 持久化与 hydrate | full（无 Cordis Config / configEditor） |
| `[data-menu-material=translucent]` · `[data-code-block-banner]` · `[data-composer-stat]` | Menu · CodeBlock · StatsLine pills | full |
| `[data-window-drag]` | DesktopChrome / BootWindowChrome 拖拽区 | full |
| `[data-process-activity]` | ProcessGroupSeat（DSH 活动词：thinking / read / search / …） | full |
| `[data-dsh-panel-host]` / `[data-dsh-toggle-cluster]`（better-sidebar） | 本仓不 stamp；boot CSS 按对方属性隐藏 | 对方插件自挂 |
| CSS-module 哈希类名 / better-sidebar `_pane` 后缀 | **不**伪造；社区应以 data-* / `--dsw-*` 为准 | refuse（类名不稳定） |

**不可依赖**：把构建哈希类名当契约；指望独立的 code/terminal 字号档（今日与 content 同值）；指望 Cordis `configEditor` 写 patch YAML（XRK 走 settings 文档）。

### 主题 / 外观族（市场 Theme 卡 · 通用底层）

原则：**按形状适配、不按包名 fork**。装包 stage `client.js` + `assets/` · `preview/` · `locale/` · `skins/` · `sounds/` · `skin.json`；偏好走 `configForms`/`settingsScope`；样式靠 `--dsw-*` 令牌与上表 DOM 锚点。

| 对方（示例） | 本桥接 | 等级 |
|---|---|---|
| `dsh-theme-endfield` | 令牌覆盖 + configForms 别名 + stage `sounds/`；Host `index.js` 经 apply 可挂音频 | full（无 Cordis patch 互斥；余额胶囊依赖上游渠道 API 时 degraded） |
| `dsh-skin` · `dsh-qq2006` · `dsh-gui-customization` · `freestyle-dsh-theme` · `dsh-xiaoyao-skins` | 同：`--dsw-*` 重绑 + DOM 锚 + settings 持久化 + 资源 stage | full（纯 client 主题） |
| `dsh-plugin-background` / wallpaper 系 | 见 wallpaper 节；背景上传走 bridge | partial～full 按路径 |
| deep-whale `maid-atelier` · `orca-link` 等 | skin-assets + `/api/dsh/skins` + DOM 双戳 | full |
| `dsh-deepcel`（把壳重编码成「表格」入口） | DOM/令牌可用；**结构重映射**依赖对方 client 自挂，不保证与 XRK 会话树一一对应 | degraded（结构） |

---


## `dsh-plugin-wallpaper-engine`（[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)）

对方 Host 真源：插件 `docs/ROUTE-INDEX.md`（约 47 条，主包 + `media-bridge` / `fonts` / `mascot-avatar` / `about-notice` / `glass` / `pet-link` 子包）。Client 唯一出口：`src/api-client.js`（`BASE=/wallpaper-engine`）。

### 打包与装载

| 对方 | 本桥接 | 原因或后续 |
|---|---|---|
| Cordis 行 + `cordis.patch.yml` 拉起子包（`wallpaper-engine-media-bridge` 等） | 当前 **不**跑对方 `lib/index.js` apply；由 `xrk-wallpaper` baseline 按路径形状服务 | 子包依赖 `ctx.wallpaperEngineHost`、Steam 发现、ffmpeg、独立 media-origin；整包 apply 是后续里程碑 |
| 安装拷 `lib/` · `packages/` · 资源 | CLI 拷 `client.js` + 常规 asset 目录；**未**整树 stage `packages/` | 待 Cordis apply 时与 WorkBuddy `lib/` staging 同级补齐 |
| 设置白名单 `lib/settings-schema.js`（构建期内联进 client） | Host 合并写入、不重跑对方 sanitize | 错键可能被对方 client 本地丢掉；后续可内联同源 sanitize |

### HTTP 表面（相对 `BASE=/wallpaper-engine`，另含无前缀根）

图例：**full** = 形状与语义可用 · **degraded** = 形状对齐但能力缩水 · **refuse** = 诚实失败/占位说明 · **stub** = 占位字节以免 UI 挂死

| # | 路径 | 对方 | 本桥接 | 等级 |
|---|---|---|---|---|
| 1 | `GET/PUT /settings` | 整段读写 `config.json` | 文件真源 `~/.xrk/…/wallpaper-engine/config.json` | full（无 schema 消毒） |
| 2 | `GET/PUT /settings/<ns>` | 按命名空间写簇 | 同文档合并；未知 ns 仍合并整段并回 `ignored` 提示 | degraded |
| 3 | `GET /inventory` | Steam WE 库 + 上传 + playlist；条目带 `type`/`playable`/`media`/`preview`/scene URL | **仅上传目录**；条目形状对齐 picker（`type`/`playable`/`media`/`preview`）；`weAssetsAvailable:false`；`portableCount`=`wallpapers.length` | degraded |
| 4 | `POST /upload` · `POST /remove` | 上传/删除自定义图视频 | 同；id 为内容哈希 | full（自定义子集） |
| 5 | `POST /upload-dir` | 改上传根目录 | 回当前 `uploadDir` + note（不改根） | refuse→degraded |
| 6 | `GET /media/<token>` · `/preview/<token>` | Range 视频/预览 | 上传文件按 id 直出；未知 token → 404 JSON | degraded（无 Steam token 表） |
| 7 | `/scene-frame` · `/scene-anim`（含无 BASE 根路径） | WebWallGL / ffmpeg 帧 | 1×1 PNG stub | stub |
| 8 | `/scene-live` · `/scene-files` · `/scene-video` · `/scene-audio` · `/live-frame` · `/props` | 场景实时与属性 | JSON note / PNG stub | refuse / stub |
| 9 | `/transcoded` · `/transcode-progress` · `/media-info` · `/video-preview` | ffmpeg 转码族 | `ok:false` + note，或进度直接 `done:true` | refuse / degraded |
| 10 | `/media-status` · `/audio-spectrum` · `/now-playing` · `/media-control` | 系统媒体桥 | 空闲形状（未播放） | degraded |
| 11 | `/system-fonts` · `/fontsets` | 枚举本机字体 | 空列表 + note | degraded |
| 12 | `/glass-presets` · `/glass-row-state` · `/mascot` · `/avatar` · `/rope-art` | 外观子包 | 空/占位 JSON | degraded |
| 13 | `/diag` · `/diag-log` · `/client-diag` | 诊断 | 最小 ok 载荷 | degraded |
| 14 | `/cache-dir` · `/we-assets-dir` · `/media-origin` | 目录与媒体源 | 回报本桥接数据根；不可改 Steam/WE 根 | degraded |
| 15 | `/occlusion` · `/pet-link/*` · `/star-count` · `/about-qr` | 平台遮挡 / 宠物联动 / 关于 | 诚实 note | refuse |
| 16 | `/api/local-assets` | WE 素材目录 | `available:false` | refuse |

**客户端可依赖的子集（今日）**：自定义上传图/视频轮播与设置持久化、占位场景帧不炸 UI。  
**不可依赖**：Steam 工坊库扫描、Scene WebWallGL、ffmpeg 转码、系统 Now Playing、遮挡暂停。

---

## `@smalltailqwq/dsh-client-ui-skin-*`（[Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)）

系列含 manager + 皮肤包（`maid-atelier` · `orca-link` 等）。Host 契约见 manager `src/contract.ts`：`SKIN_MANAGER_ROUTE = /api/dsh/skins`。

### 打包与装载

| 对方 | 本桥接 | 原因或后续 |
|---|---|---|
| 各包 `dsh.client` + `skin.json`；manager inject settings | 安装 stage `client.js` · `skin.json` · `assets/` · `preview/` · `skins/`；scoped 名走族对齐 | ModuleLoader 族适配覆盖 `@smalltailqwq/…` |
| Cordis patch 互斥启停皮肤 | **不**改写第三方 patch YAML；只持久化 `activeSkinId`，靠 client reload 切换 | 与 DSH 准入/豁免不同；XRK 不 gate `dshCompatibility` semver（可记 `acceptedRisk`） |

### `/api/dsh/skins`（及 `/api/skin-manager/*` 别名）

| 操作 | 对方 | 本桥接 | 等级 |
|---|---|---|---|
| `GET` | `{ ok, skins: SkinCatalogEntry[], desktopIcon? }`；条目含 `id/name/package/wiringId/bodyAttr/order/…` | 发现 staged `skin.json`；补齐 `order`（缺省 0）；`activeSkinId`；`desktopIcon.enabled` 偏好 | full（目录） |
| `POST { target, acceptRisk? }` | 切换 + 越界豁免 | 持久化偏好；回 ok + reload note | degraded（无 Cordis patch 热切） |
| `POST { action: "local-versions" }` | git/build 指纹 | inventory version 行，`source: "build"` | degraded |
| `POST { action: "versions" }` | GitHub compare | `remote: null` + note | refuse→degraded |
| `POST { action: "desktop-icon" }` | 改桌面图标 | 只存偏好；Desktop shell 才真正换图标 | degraded |
| `GET /skin-assets/<id>/<hash>` | 静态皮肤资源 | `xrk-skin-assets` 按 staged 树服务 | full |
| skin-center / dream-skin / skin-market | 各家中心协议 | 独立 provider；见 community-plugins 表 | 按包 |

**客户端可依赖的子集（今日）**：安装皮肤包后 Settings 目录可见、切换写入偏好、资源 URL 可加载。  
**不可依赖**：GitHub 更新探测、DSH 版本准入强制禁用、Desktop 图标文件替换（无 Desktop Host 时）。

---

## 维护纪律（学 CC mods 桥）

1. **矩阵先于代码**：新社区 HTTP/RPC 先加本页一行（full/degraded/refuse），再改 bridge。  
2. **形状对齐优先于能力吹嘘**：inventory 字段名跟 picker 契约，哪怕 Steam 侧为空。  
3. **未服务要具名**：JSON `note` / `ok:false` / ModuleLoader mis-stamped，禁止静默 200 空对象冒充成功。  
4. **具名适配按族、不按 publisher**：`isPluginPackageFamily(name, "dsh-…")`。  
5. **冲突裁决**：代码 > status「能跑」> 本矩阵 > 社区 README。

---

## English

> **Audience**: Integrators · maintainers (map community client expectations to Host surfaces)

Same table style as DSH’s Claude Code mods compatibility page: each row = **upstream** · **this bridge** · **why / later**. Code truth: `packages/server/http/src/dsh-compat/`. See also [community-plugins.md](./community-plugins.md).

Shared layer: scoped ↔ bare ModuleLoader family dual-register (install + `serve` reconcile align stamps; runtime dual-keys by boot-graph family so parallel `async` prefetch cannot drop a bare stamp under a sibling `executingId`); root Cordis `index.js` staged by layout (not publisher list) with incomplete-host restage only when `package.json` declares it missing; Host apply routes before baseline; named hosts match bare family ids; catch-all is `incomplete` (path-shape empty arrays only for known Settings contracts).

**DOM / CSS naming**: XRK dual-stamps DSH frame vars (`--dsh-windows-titlebar-height`, `--dsh-frame-*`, `--dsh-windows-content-radius`), menu / elevation / shimmer / turn-trigger tokens, `data-windows-titlebar`, `data-window-drag`, `data-process-activity`, theme-source, conversation / bubble / turn-process / disclosure-header / shortcut-modal / animating / shell-leading / panel-conversation / cordis-approve / menu-material / boot anchors — see Chinese table (`dsh-style-aliases.ts`). `ctx.configForms` is a thin alias over `settingsScope` (`describe.ensure` / `whileServed`); Face persists community settings namespaces in `settings.yaml`. Marketplace Theme cards share that underlay (no per-package Host fork); structural remappers like `dsh-deepcel` stay degraded. Hashed CSS-module class names are not faked.

**Wallpaper Engine**: custom upload + settings + picker-shaped inventory are usable; Steam library, WebWallGL, ffmpeg, Now Playing, occlusion are not. Route grades live in the Chinese tables above.

**Deep whale skins**: catalog GET (with `order`) + preference switch + skin-assets are usable; GitHub version compare and Cordis exclusive patch hot-swap are not.
