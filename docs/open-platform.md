# 开放平台（作者总览）

> **读者**：集成者 · 贡献者 · 第三方插件作者

XRK-Harness 把扩展面收成 **XRK Plug**（`@xrkseek/plug`）：进程半部进 Host，client 半部叠壳，壳公开 **LayoutInsets / reserve\*** 让浮动 UI 多端可共存。本文是总览；细节链到分册。

## 你能改什么

| 面 | 怎么进 | 金样 / 入口 |
|----|--------|-------------|
| 模型工具 | 进程 `kind: tools` | `extensions/example-tools` · [plugin-development](./plugin-development.md) |
| System 段 | `kind: prompt` | `example-prompt` |
| 斜杠 / 命令 | `kind: commands` | `example-commands` |
| 策略 / 钩子 / LLM brand / 通道 | `policy` · `hooks` · `llm` · `channel` | 同表金样 |
| 输入区 / 槽位 UI | `xrk.client` | `example-composer-action` · [client-plugin-development](./client-plugin-development.md) |
| 主题 token | `xrk.client` + ThemeRuntime | `example-theme-tokens` |
| 壳叠层（壁纸 / 小宠物） | `shell.overlay` 等槽 | `example-shell-wallpaper` · `example-shell-pet` |
| **浮动工作台让位** | `ctx.layout.reserveSide` / `reserveBottom` | `example-workbench-push` · [sidebar-workbench](./sidebar-workbench.md) |
| MCP 服务器 | Settings → MCP | [modules/mcp.md](./modules/mcp.md) |
| 社区已有壳包 | `xrkh plugin add` | [community-plugins](./community-plugins.md) |

表面分级（P0–P3）：[plugin-surface-map](./plugin-surface-map.md)。能力是否可依赖：[status](./status.md)。

## 多端几何（必读）

第三方**不要**为让位去改 Host；也不要假定本机有社区 `layout.css`。

1. **侧宽**：`ctx.layout.reserveSide(px)`（`0` = 关）→ 壳整框 `margin-right`  
2. **底高**：`ctx.layout.reserveBottom(px)`（`0` = 关）→ 对话列 `padding-bottom`  
3. **读壳已占**：`ctx.layout.insets` 或 `--xrk-layout-inset-*`  
4. **地板**：`xrkPlugPushFloor({ shellOccupied: xrkPlugShellOccupied(insets) })`；视口不够则 push `0`（浮层）  
5. **手机**：`insets.phone` 时壳强制底/侧为 `0`；概况开时收 FAB / 抽屉  
6. **键盘**：宽屏 `--xrk-keyboard-inset = 0`；Flutter 薄壳自管  

完整契约：[sidebar-workbench](./sidebar-workbench.md)。

## 信任与安装

- 进程插件与 Host **同进程**（可读密钥、跑工具）——只装信任源；见 [security-checklist](./security-checklist.md)。  
- Client 半部：`xrkh plugin add <path|npm>` → `~/.xrk/plugins/web/`；Settings → 插件可热重载。  
- 本地玩金样：`xrkh plugin add ./extensions/<id>` → 硬刷新或「重载」。

## 作者包 `@xrkseek/plug`

```ts
import {
  XRK_PLUG,
  xrkPlugPushFloor,
  xrkPlugShellOccupied,
  xrkPlugWorkbenchRoom,
  xrkPlugFitWorkbenchWidth,
} from '@xrkseek/plug'
```

| 符号 | 用途 |
|------|------|
| `XRK_PLUG.processKinds` | Host 可发现的进程 kind |
| `XRK_PLUG.slots` | 常用槽位名 |
| `XRK_PLUG.layoutInsetCssVars` / `workbenchCssVars` | CSS 名（优先 JS API） |
| `XRK_PLUG.keyboardInsetCss` · `layoutAttrs` | 键盘 / phone 选择器 |
| `xrkPlugPushFloor` · `xrkPlugShellOccupied` | 推挤地板 |
| `xrkPlugWorkbenchRoom` · `xrkPlugFitWorkbenchWidth` | 侧栏宽度求解（与第一方工作台同政策） |

## 不止 UI：无头与 Host 面

| 面 | 做什么 | 文档 |
|----|--------|------|
| HTTP / Face RPC | 无头会话 · 工具轨 · Settings | [http-api](./http-api.md) · [host-face](./host-face.md) |
| 工具管道 / 守卫 | 注册工具 · 钩子 · policy | [tool-pipeline](./tool-pipeline.md) · [policy](./policy.md) |
| Preset / 徽章 | 组合现有包，不写业务 | [profiles](./profiles.md) · [host-preset](./host-preset.md) |
| MCP | 外挂服务器热挂载 | [modules/mcp](./modules/mcp.md) |
| 社区壳包 | 可选兼容器；逐表面矩阵 | [community-plugins](./community-plugins.md) · [community-plugin-compat](./community-plugin-compat.md) |
| 安全 | 同进程信任边界 | [security-checklist](./security-checklist.md) |

能力是否可依赖：[status](./status.md)。

## 建议游玩顺序

1. `example-tools` → 模型能调你的工具  
2. `example-composer-action` → 输入区多一颗钮  
3. `example-workbench-push` → 侧栏让位 / 收回，看对话列是否被盖住  
4. `example-hooks` / `example-policy` → 管道与守卫  
5. 再读 [http-api](./http-api.md) / [host-face](./host-face.md) 接无头集成  

---

# Open platform (author overview)

> **Audience**: Integrators · Contributors · Third-party plugin authors

XRK-Harness exposes extensions through **XRK Plug** (`@xrkseek/plug`): process halves join the Host, client halves overlay the shell, and the shell publishes **LayoutInsets / reserve\*** so floating UI can coexist across desktop / web / phone. This page is the map; detail lives in the linked books.

## What you can extend

| Surface | How | Gold sample / entry |
|---------|-----|---------------------|
| Model tools | Process `kind: tools` | `extensions/example-tools` · [plugin-development](./plugin-development.md) |
| System sections | `kind: prompt` | `example-prompt` |
| Slash / commands | `kind: commands` | `example-commands` |
| Policy / hooks / LLM brand / channels | `policy` · `hooks` · `llm` · `channel` | Matching samples |
| Composer / slot UI | `xrk.client` | `example-composer-action` · [client-plugin-development](./client-plugin-development.md) |
| Theme tokens | `xrk.client` + ThemeRuntime | `example-theme-tokens` |
| Shell overlays | `shell.overlay` etc. | `example-shell-wallpaper` · `example-shell-pet` |
| **Floating workbench yield** | `ctx.layout.reserveSide` / `reserveBottom` | `example-workbench-push` · [sidebar-workbench](./sidebar-workbench.md) |
| MCP servers | Settings → MCP | [modules/mcp.md](./modules/mcp.md) |
| Existing community shells | `xrkh plugin add` | [community-plugins](./community-plugins.md) |

Surface classes (P0–P3): [plugin-surface-map](./plugin-surface-map.md). Dependability: [status](./status.md).

## Multi-end geometry (required)

Third parties must **not** patch the Host for yield, and must **not** assume a community `layout.css` is present.

1. **Side width:** `ctx.layout.reserveSide(px)` (`0` = closed) → shell frame `margin-right`  
2. **Bottom height:** `ctx.layout.reserveBottom(px)` (`0` = closed) → conversation `padding-bottom`  
3. **Read shell occupancy:** `ctx.layout.insets` or `--xrk-layout-inset-*`  
4. **Floor:** `xrkPlugPushFloor({ shellOccupied: xrkPlugShellOccupied(insets) })`; push `0` (float) when the viewport is too narrow  
5. **Phone:** `insets.phone` forces bottom/side to `0`; hide FABs / drawers when Overview is open  
6. **Keyboard:** wide `--xrk-keyboard-inset = 0`; Flutter thin shells own the inset  

Full contract: [sidebar-workbench](./sidebar-workbench.md).

## Trust and install

- Process plugins share the Host process (secrets, tools) — install only trusted sources; see [security-checklist](./security-checklist.md).  
- Client half: `xrkh plugin add <path|npm>` → `~/.xrk/plugins/web/`; Settings → Plugins can soft-reload.  
- Local samples: `xrkh plugin add ./extensions/<id>` → hard refresh or **Reload**.

## Author package `@xrkseek/plug`

| Symbol | Role |
|--------|------|
| `XRK_PLUG.processKinds` | Discoverable process kinds |
| `XRK_PLUG.slots` | Common slot names |
| `XRK_PLUG.layoutInsetCssVars` / `workbenchCssVars` | CSS names (prefer JS APIs) |
| `XRK_PLUG.keyboardInsetCss` · `layoutAttrs` | Keyboard / phone selectors |
| `xrkPlugPushFloor` · `xrkPlugShellOccupied` | Push floors |
| `xrkPlugWorkbenchRoom` · `xrkPlugFitWorkbenchWidth` | Side-width solve (same policy as the first-party workbench) |

## Beyond UI: headless and Host surfaces

| Surface | Role | Docs |
|---------|------|------|
| HTTP / Face RPC | Headless sessions · tool rail · Settings | [http-api](./http-api.md) · [host-face](./host-face.md) |
| Tool pipeline / guards | Register tools · hooks · policy | [tool-pipeline](./tool-pipeline.md) · [policy](./policy.md) |
| Preset / badge | Compose packages; no business logic | [profiles](./profiles.md) · [host-preset](./host-preset.md) |
| MCP | External servers, hot-mount | [modules/mcp](./modules/mcp.md) |
| Community shells | Optional compat; per-surface matrix | [community-plugins](./community-plugins.md) · [community-plugin-compat](./community-plugin-compat.md) |
| Security | Same-process trust boundary | [security-checklist](./security-checklist.md) |

Dependability: [status](./status.md).

## Suggested play order

1. `example-tools` → the model can call your tool  
2. `example-composer-action` → a composer button  
3. `example-workbench-push` → side yield / release; confirm chat is not covered  
4. `example-hooks` / `example-policy` → pipeline and guards  
5. Then [http-api](./http-api.md) / [host-face](./host-face.md) for headless integration  
