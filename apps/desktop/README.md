# `@xrkseek/harness-desktop`

> **读者**：维护者 · 贡献者

私有 Electron 桌面壳（workspace `apps/desktop`）。包名 **`@xrkseek/harness-desktop`**，**`private: true`**，不进公共 npm。产品能力在 [status.md](../../docs/status.md) 仍为 **未做**（脚本与单测 ≠ 整包可跑）。架构决策：[ADR-0008](../../docs/adr/0008-desktop-shell-private-host.md)。

桌面壳包裹已组装的 XRK Web UI；**不开**产品 Web 监听端口。私有 Host（`@xrkseek/harness-desktop-host`）在上游 Node 子进程中组合本仓 Host / Face；`xrk-app://` 提供静态资源与 Fetch 入口；分帧管道承载请求/响应；Node IPC **仅**生命周期。

## 关键决策

| 决策 | 含义 | 直接结果 |
|------|------|----------|
| **发布身份** | 壳 · Desktop Host · Web dist · 插件依赖图 · 内置 Node/pnpm（及日后 seed）同一 Desktop 发布号 | 禁止「仅壳 / 仅 runtime」分轨；CLI npm 线（`@xrkseek/harness-cli`）**不是** Desktop 身份的一部分 |
| **运行时** | 打包后用捆绑上游 Node + 钉死 pnpm；开发投影可用调用方 Node（须文档标明） | 系统 pnpm / 用户 npm 配置不进产品执行路径 |
| **通信** | 无产品 listen；`xrk-app://` + 分帧管道；IPC 仅生命周期 | 不回退到「本机 HTTP serve 第二入口」 |
| **状态归属** | 共享 `~/.xrk` 产品数据；隔离 desktop profile · lock · `node_modules` · 桌面 pnpm store | CLI **不得**启动/改写 `profiles/desktop`；单实例锁为主 owner |
| **激活** | staging → 健康检查 → 日记激活 → rollback / recover | `DesktopProfileTransactionManager`；≠ 离线 seed 已可装 |
| **更新** | 更新单元 = 壳 + runtime + seed 同版；MVP = **整包** | 差分块复用 / 上传流水线 **二期**；骨架 ≠ 已接发版流 |
| **插件安装** | 结构化 list/add/remove/update；内置 pnpm 固定 argv | ≠ CLI `xrkh plugin` / `web/boot.json` overlay / dsh-compat；`isDesktopPluginInstallReady()===false` |
| **打包目标** | 第一波 **`win-x64`** · **`mac-arm64`** | Linux / mac-x64 / win-arm64 **暂缓**；**真签 / 公证未做** |

## 布局

| 路径 | 用途 |
|------|------|
| `apps/desktop` | Electron 壳源码（本包） |
| `apps/desktop-host` | 私有 Host 入口（compose / Face；**无** Cordis boot） |
| `apps/web/dist` | 已组装产品 Web（`web:build` · `client:bundle` · `web:assemble`） |
| `apps/desktop/.desktop-build/development/home` | 未打包默认 Harness home（隔离；≠ 用户 `~/.xrk`，除非设 `XRK_HOME`） |
| `apps/desktop/.desktop-build/development/project` | 开发投影一次性 npm 项目（`prepareDesktopDevelopmentProject`） |
| `apps/desktop/.desktop-build/development/electron-user-data` | Electron userData |
| `apps/desktop/.desktop-build/targets/<target>/` | 按目标隔离的 runtime · package-set · seed 等可变目录 |
| `apps/desktop/.desktop-build/downloads/` | 跨目标共享的官方 Node 归档缓存 |
| `~/.xrk/profiles/desktop` | 保留 Desktop profile（打包安装后） |
| `~/.xrk/desktop/pnpm/store` 等 | 桌面专用 pnpm 状态 |

协议方案名：**`xrk-app`**。渲染：`sandbox` + `contextIsolation` + `nodeIntegration: false`；preload 仅类型化 API（locale · 更新；插件接线二期）。

## 开发命令

需 **Node ≥26**（与根 `engines` 一致）。根脚本：

| 命令 | 作用 |
|------|------|
| `pnpm build:desktop` | 构建 `desktop-host...` + Web 组装 |
| `pnpm dev:desktop` | 先 `build:desktop`，再尝试启动 Electron（本包须已装 `electron`） |
| `pnpm start:desktop` | 跳过构建；须已有 `apps/desktop/dist` · `apps/desktop-host/dist` · `apps/web/dist` |

本包脚本：

```bash
pnpm --filter @xrkseek/harness-desktop prepare:runtime [-- <win-x64|mac-arm64>]
pnpm --filter @xrkseek/harness-desktop prepare:package-set [-- <target>]
```

开发投影默认不下载捆绑 Node；验证捆绑 runtime / seed / 插件事务时走打包准备路径（产品仍 **未做**）。日常产品配置优先 **Settings UI**；Desktop 不另起平行设置真源。

相关单测（`apps/desktop/tests`）：单实例 · host-protocol · host-process · 开发投影 · 打包目标/路径矩阵 · i18n 字典键集等。壳文案：`src/locale.ts`（中英同键；非 zh 英文 fallback）；`pnpm check` 含 `verify-client-ui-i18n --desktop-only`。

## 打包环境变量

以下为代码已识别或已钉名的变量。**真签 / 公证 / 自动上传流水线未接线**；表中「规划」项不得当成已支持。

| 变量 | 用途 |
|------|------|
| `XRK_HOME`（及 server-config 别名） | 产品 Harness home；开发投影未设时用隔离 `.desktop-build/development/home` |
| `XRK_DESKTOP_WEB_ROOT` | 覆盖 `xrk-app://` 静态根（默认 `apps/web/dist`） |
| `XRK_DESKTOP_TARGET` | 显式打包目标：`win-x64` \| `mac-arm64` |
| `XRK_DESKTOP_TARGET_PLATFORM` | 推导目标时的平台覆盖（`darwin`/`win32`/`linux`…） |
| `XRK_DESKTOP_TARGET_ARCH` | 推导目标时的 CPU 覆盖（`arm64`/`x64`） |
| `ELECTRON_USER_DATA_DIR` | Electron userData（`dev:desktop` 默认指向 development 布局） |
| `XRK_DESKTOP_WINDOWS_*` | **规划**：Windows 签名相关（前缀会从准备子进程环境剥离；**真签未做**） |
| `XRK_DESKTOP_UPLOAD_SECRET_ID` / `…_SECRET_KEY` | **规划**：上传凭据（打包子进程剥离；上传 **二期**） |
| `XRK_DESKTOP_UPLOAD_TEST_SECRET_ID` / `…_SECRET_KEY` | **规划**：测试频道上传凭据（同上） |

第一波目标与宿主兼容、builder draft argv、凭据剥离真源：`src/package-targets.ts` · `src/build-paths.ts`。

## 诚实边界

- Desktop 在 [status.md](../../docs/status.md) 当前为 **未做**；分阶段升格：**未稳** = `dev:desktop` 开发投影可跑 → **能跑** = 第一波 `win-x64`/`mac-arm64` 打包可用（禁止跳级写成已支持）。  
- 无完整 electron-builder 发版、无真签/公证、无已接更新频道、插件安装未就绪。  
- Seed：**开发投影优先**；离线 seed / 16 分片 / CAS 公证 **暂缓或未实现**（见 ADR-0008 · `isDesktopOfflineSeedReady()`）。  
- 禁止把社区 client overlay / dsh-compat 能力表当作 Desktop 插件安装通道（见 [community-plugins.md](../../docs/community-plugins.md)）。

---

# `@xrkseek/harness-desktop`

> **Audience**: Maintainers · Contributors

Private Electron desktop shell (workspace `apps/desktop`). Package **`@xrkseek/harness-desktop`**, **`private: true`** — not on public npm. Product capability remains **Not done** in [status.md](../../docs/status.md) (scripts and unit tests ≠ a runnable package). Architecture: [ADR-0008](../../docs/adr/0008-desktop-shell-private-host.md).

The shell wraps the assembled XRK Web UI and opens **no** product Web listen port. The private Host (`@xrkseek/harness-desktop-host`) composes this repo’s Host / Face under an upstream-Node child; `xrk-app://` serves static assets and Fetch; framed pipes carry request/response bodies; Node IPC is **lifecycle-only**.

## Key decisions

| Decision | Meaning | Direct result |
|----------|---------|---------------|
| **Release identity** | Shell · Desktop Host · Web dist · plugin graph · bundled Node/pnpm (and seed later) share one Desktop release number | No “shell-only / runtime-only” split tracks; the public CLI line (`@xrkseek/harness-cli`) is **not** part of Desktop identity |
| **Runtime** | Packaged builds use bundled upstream Node + pinned pnpm; development projection may use caller Node (must be documented) | System pnpm / user npm config stay off the product execution path |
| **Transport** | No product listen; `xrk-app://` + framed pipes; IPC lifecycle-only | No fallback to a local HTTP `serve` second entry |
| **State ownership** | Share `~/.xrk` product data; isolate desktop profile · lock · `node_modules` · desktop pnpm store | CLI **must not** start/mutate `profiles/desktop`; single-instance lock is the primary owner |
| **Activation** | staging → health check → journaled activate → rollback / recover | `DesktopProfileTransactionManager`; ≠ offline seed installable |
| **Updates** | Update unit = shell + runtime + seed, same version; MVP = **full-package** | Blockmap differential / upload pipeline **phase 2**; skeleton ≠ wired publish feed |
| **Plugin install** | Structured list/add/remove/update; fixed bundled-pnpm argv | ≠ CLI `xrkh plugin` / `web/boot.json` overlay / dsh-compat; `isDesktopPluginInstallReady()===false` |
| **Packaging targets** | First wave **`win-x64`** · **`mac-arm64`** | Linux / mac-x64 / win-arm64 **deferred**; **real signing / notarization not done** |

## Layout

| Path | Role |
|------|------|
| `apps/desktop` | Electron shell sources (this package) |
| `apps/desktop-host` | Private Host entry (compose / Face; **no** Cordis boot) |
| `apps/web/dist` | Assembled product Web (`web:build` · `client:bundle` · `web:assemble`) |
| `apps/desktop/.desktop-build/development/home` | Default unpackaged Harness home (isolated; ≠ user `~/.xrk` unless `XRK_HOME` is set) |
| `apps/desktop/.desktop-build/development/project` | Disposable development npm project (`prepareDesktopDevelopmentProject`) |
| `apps/desktop/.desktop-build/development/electron-user-data` | Electron userData |
| `apps/desktop/.desktop-build/targets/<target>/` | Per-target mutable runtime · package-set · seed dirs |
| `apps/desktop/.desktop-build/downloads/` | Shared official Node archive cache |
| `~/.xrk/profiles/desktop` | Reserved Desktop profile (after packaged install) |
| `~/.xrk/desktop/pnpm/store` etc. | Desktop-owned pnpm state |

Protocol scheme: **`xrk-app`**. Renderer: `sandbox` + `contextIsolation` + `nodeIntegration: false`; preload exposes typed APIs only (locale · updates; plugin wiring phase 2).

## Development commands

Requires **Node ≥26** (same as root `engines`). Root scripts:

| Command | Role |
|---------|------|
| `pnpm build:desktop` | Build `desktop-host...` + Web assemble |
| `pnpm dev:desktop` | Run `build:desktop`, then try Electron (`electron` must be installed on this package) |
| `pnpm start:desktop` | Skip build; needs existing `apps/desktop/dist` · `apps/desktop-host/dist` · `apps/web/dist` |

Package scripts:

```bash
pnpm --filter @xrkseek/harness-desktop prepare:runtime [-- <win-x64|mac-arm64>]
pnpm --filter @xrkseek/harness-desktop prepare:package-set [-- <target>]
```

Development projection does not download the bundled Node by default; use packaging prep paths to exercise bundled runtime / seed / plugin transactions (product still **Not done**). Day-to-day product config stays in **Settings UI**; Desktop does not invent a parallel settings source.

Related unit tests (`apps/desktop/tests`): single-instance · host-protocol · host-process · development projection · packaging target/path matrix · i18n key sets, etc. Shell copy: `src/locale.ts` (matching en+zh keys; English fallback for non-zh); `pnpm check` includes `verify-client-ui-i18n --desktop-only`.

## Packaging environment variables

Variables recognized or name-locked in code. **Real signing / notarization / auto-upload are not wired**; rows marked “planned” must not be treated as supported.

| Variable | Role |
|----------|------|
| `XRK_HOME` (and server-config aliases) | Product Harness home; unpackaged default is isolated `.desktop-build/development/home` when unset |
| `XRK_DESKTOP_WEB_ROOT` | Override `xrk-app://` static root (default `apps/web/dist`) |
| `XRK_DESKTOP_TARGET` | Explicit packaging target: `win-x64` \| `mac-arm64` |
| `XRK_DESKTOP_TARGET_PLATFORM` | Platform override when deriving the target |
| `XRK_DESKTOP_TARGET_ARCH` | CPU override when deriving the target |
| `ELECTRON_USER_DATA_DIR` | Electron userData (`dev:desktop` defaults to the development layout) |
| `XRK_DESKTOP_WINDOWS_*` | **Planned**: Windows signing fields (prefix scrubbed from prep subprocess env; **real signing not done**) |
| `XRK_DESKTOP_UPLOAD_SECRET_ID` / `…_SECRET_KEY` | **Planned**: upload credentials (scrubbed from packaging subprocesses; upload **phase 2**) |
| `XRK_DESKTOP_UPLOAD_TEST_SECRET_ID` / `…_SECRET_KEY` | **Planned**: test-channel upload credentials (same) |

First-wave targets, host compatibility, draft builder argv, and credential scrubbing: `src/package-targets.ts` · `src/build-paths.ts`.

## Honesty

- Desktop is **Not done** in [status.md](../../docs/status.md) today; phased graduation: **Unstable** = `dev:desktop` development projection runs → **Working** = first-wave `win-x64`/`mac-arm64` packaging usable (no skip-ahead claims).  
- No full electron-builder ship, no real signing/notarization, no wired update channel, plugin install not ready.  
- Seed: **development projection first**; offline seed / 16-shard / CAS notarization **deferred or unimplemented** (ADR-0008 · `isDesktopOfflineSeedReady()`).  
- Do not treat community client overlay / the dsh-compat capability table as the Desktop plugin install channel (see [community-plugins.md](../../docs/community-plugins.md)).
