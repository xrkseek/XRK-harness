# `@xrkseek/harness-desktop`

> **读者**：维护者 · 贡献者

私有 Electron 桌面壳（workspace `apps/desktop`）。包名 **`@xrkseek/harness-desktop`**，**`private: true`**，不进公共 npm。产品能力在 [status.md](../../docs/status.md) 为 **未稳**（第一波打包流水线已开；公开发版/更新频道待凭据）。架构决策：[ADR-0008](../../docs/adr/0008-desktop-shell-private-host.md)。

桌面壳包裹已组装的 XRK Web UI；**不开**产品 Web 监听端口。私有 Host（`@xrkseek/harness-desktop-host`）在上游 Node 子进程中组合本仓 Host / Face；`xrk-app://` 提供静态资源与 Fetch 入口；分帧管道承载请求/响应；Node IPC **仅**生命周期。

**一体体验（相对 Codex / Hermes / dsh 的组合优势）**：一个安装身份 = 壳 + Desktop Host + Web dist + **同源 Face**——Session 事件 SSOT、Status（本会话 costUsage + 跨会话 cost-meter）、Settings 诚实卡族、`session.export` 的 `cost.json`（含 `dailyTrend`）、`xrkh doctor` 的 `cost-ledger` 探针，共享 `~/.xrk`，**不是**平行账本或 Cordis 嵌入 Host。日常入口仍以 CLI / Web 为准，直到 status 升「能跑」。

## 关键决策

| 决策 | 含义 | 直接结果 |
|------|------|----------|
| **发布身份** | 壳 · Desktop Host · Web dist · 插件依赖图 · 内置 Node/pnpm（及日后 seed）同一 Desktop 发布号 | 禁止「仅壳 / 仅 runtime」分轨；CLI npm 线（`@xrkseek/harness-cli`）**不是** Desktop 身份的一部分 |
| **运行时** | 打包后用捆绑上游 Node + 钉死 pnpm；开发投影可用调用方 Node（须文档标明） | 系统 pnpm / 用户 npm 配置不进产品执行路径 |
| **通信** | 无产品 listen；`xrk-app://` + 分帧管道；IPC 仅生命周期 | 不回退到「本机 HTTP serve 第二入口」 |
| **状态归属** | 共享 `~/.xrk` 产品数据；隔离 desktop profile · lock · `node_modules` · 桌面 pnpm store | CLI **不得**启动/改写 `profiles/desktop`；单实例锁为主 owner |
| **激活** | staging → 健康检查 → 日记激活 → rollback / recover | `DesktopProfileTransactionManager`；≠ 离线 seed 已可装 |
| **更新** | 更新单元 = 壳 + runtime + seed 同版；MVP = **整包** + generic `app-update.yml`；`upload:desktop` 校验 + 本地镜像 | 差分块 / COS HTTPS PUT **二期** |
| **插件安装** | 结构化 list/add/remove/update；内置 pnpm 固定 argv | ≠ CLI `xrkh plugin` / `web/boot.json` overlay / dsh-compat；`isDesktopPluginInstallReady()===false` |
| **打包目标** | 发布矩阵 **`win-x64`** · **`mac-arm64`** · **`mac-x64`**；`package:desktop` + `upload:desktop`；`installerShipped=true` | Linux / win-arm64 **暂缓**；实网 COS PUT **凭据门控**；day-1 入口仍是 CLI/Web |

## 布局

| 路径 | 用途 |
|------|------|
| `apps/desktop/src/` | 壳 · 打包矩阵 · 签名/更新/上传（TypeScript 真源） |
| `apps/desktop/scripts/` | electron-builder 工厂 · prepare-runtime/package-set · `windows-sign.cmd` |
| `apps/desktop/.env.windows.example` / `.env.macos.example` | 签名/更新本地 dotenv 模板（复制为 `.env.windows` / `.env.macos`，gitignore） |
| `apps/desktop-host` | 私有 Host 入口（compose / Face；**无** Cordis boot） |
| `apps/web/dist` | 已组装产品 Web（`web:build` · `client:bundle` · `web:assemble`） |
| `.desktop-build/development/` | 开发投影 home · project · electron-user-data（隔离；≠ `~/.xrk`） |
| `.desktop-build/downloads/` | 跨目标共享的官方 Node 归档缓存（`pnpm clean:desktop` 默认保留） |
| `.desktop-build/targets/<target>/runtime/` | 捆绑 Node + pnpm（`prepare:runtime`） |
| `.desktop-build/targets/<target>/artifacts/` | 签名安装包 + `package-complete-*.json` |
| `.desktop-build/targets/<target>/unsigned-artifacts/` | 未签名 NSIS（`-unsigned`；不嵌更新源） |
| `.desktop-build/upload-mirror/` · `upload-records/` | 本地更新频道镜像与上传记录（可 `clean:desktop`） |
| `~/.xrk/profiles/desktop` | 保留 Desktop profile（打包安装后） |

协议方案名：**`xrk-app`**。渲染：`sandbox` + `contextIsolation` + `nodeIntegration: false`；preload 仅类型化 API（locale · 更新；插件接线二期）。

## 开发命令

需 **Node ≥26**（与根 `engines` 一致）。根脚本：

| 命令 | 作用 |
|------|------|
| `pnpm build:desktop` | 构建 `desktop-host...` + Web 组装 |
| `pnpm dev:desktop` | 先 `build:desktop`，再尝试启动 Electron（须已装 optional `electron`） |
| `pnpm start:desktop` | 跳过构建；须已有 `apps/desktop/dist` · `apps/desktop-host/dist` · `apps/web/dist` |
| `pnpm package:desktop` | 打包流水线：默认校验并写 `package-plan.json`；`XRK_DESKTOP_PACKAGE=1` 调 electron-builder |
| `pnpm upload:desktop` | 更新频道上传：`--check` 只校验计划；默认写本地文件系统镜像 |
| `pnpm clean:desktop` | 清产物/镜像（默认保留 `downloads/`）；`-- --all` 连 runtime 一起清 |

本包脚本：

```bash
pnpm --filter @xrkseek/harness-desktop prepare:runtime [-- <win-x64|mac-arm64|mac-x64>]
pnpm --filter @xrkseek/harness-desktop prepare:package-set [-- <target>]
pnpm --filter @xrkseek/harness-desktop clean:build
```

开发投影默认不下载捆绑 Node；验证捆绑 runtime / seed / 插件事务时走打包准备路径。日常产品配置优先 **Settings UI**；Desktop 不另起平行设置真源。

相关单测（`apps/desktop/tests`）：单实例 · host-protocol · host-process · 开发投影 · 打包目标/路径矩阵 · 签名/更新 env · i18n 字典键集等。壳文案：`src/locale.ts`（中英同键；非 zh 英文 fallback）；`pnpm check` 含 `verify-client-ui-i18n --desktop-only`。

## 打包环境变量

| 变量 | 用途 |
|------|------|
| `XRK_HOME`（及 server-config 别名） | 产品 Harness home；开发投影未设时用隔离 `.desktop-build/development/home` |
| `XRK_DESKTOP_WEB_ROOT` | 覆盖 `xrk-app://` 静态根（默认 `apps/web/dist`） |
| `XRK_DESKTOP_TARGET` | 显式打包目标：`win-x64` \| `mac-arm64` \| `mac-x64` |
| `XRK_DESKTOP_TARGET_PLATFORM` / `XRK_DESKTOP_TARGET_ARCH` | 推导目标时的平台/CPU 覆盖 |
| `XRK_DESKTOP_PACKAGE=1` | 真正调用 electron-builder（默认仅校验流水线） |
| `XRK_DESKTOP_UNSIGNED=1` | 未签名 Windows NSIS（产物名 `-unsigned`；不嵌 `app-update.yml`；仅 win-x64） |
| `XRK_DESKTOP_WINDOWS_*` | Windows 真签（须齐：`CER_FILE` · `SIGNTOOL` · `TOKEN_PIN` · `KEY_CONTAINER`）。本地填 `.env.windows`（自 example 复制） |
| `XRK_DESKTOP_MACOS_IDENTITY` / `APPLE_ID*` / `TEAM_ID` | macOS 签名；Apple-id 三件齐则 notarize（`.env.macos`） |
| `XRK_DESKTOP_AUTO_UPDATE_ENV` | `test` \| `production`（默认 test） |
| `XRK_DESKTOP_UPDATE_TEST_ORIGIN` / `XRK_DESKTOP_UPDATE_ORIGIN` | generic 更新源；写入 `app-update.yml`（**unsigned 不写**） |
| `XRK_DESKTOP_UPDATE_FORCE=1` | 开发态强制启用更新检查（仍需可解析的 feed） |
| `XRK_DESKTOP_UPDATE_CHECK_INTERVAL_MS` / `MAX_BACKOFF_MS` / `JITTER` | 自动检查间隔 · 退避上限 · 抖动（默认 10min / 1h / 0.2） |
| `XRK_DESKTOP_UPLOAD_*` | 更新频道上传（bucket / secret；打包子进程剥离；`pnpm upload:desktop`） |
| `ELECTRON_USER_DATA_DIR` | Electron userData（`dev:desktop` 默认指向 development 布局） |

真源：`src/package-targets.ts` · `src/desktop-package-environment.ts` · `src/desktop-signing-environment.ts` · `src/windows-sign.ts` · `src/desktop-auto-update-environment.ts` · `src/update-coordinator.ts` · `src/update-schedule.ts` · `src/desktop-electron-updater.ts` · `src/desktop-upload-plan.ts` · `src/desktop-upload-run.ts` · `scripts/windows-sign.cmd` · `electron-builder.config.mjs`。

## 诚实边界

- Desktop 在 [status.md](../../docs/status.md) 当前为 **未稳**：打包 + 更新上传 CI 已开（`installerShipped=true`）；实网 COS PUT / 公开签名发版后升 **能跑**。
- 默认产品入口是 `xrkh web` / CLI。`pnpm package:desktop` 不再无条件拒绝；未装 electron-builder 时 `XRK_DESKTOP_PACKAGE=1` 诚实失败。
- Seed：开发投影优先；离线 seed / 16 分片 **暂缓**。
- 禁止把社区 client overlay / dsh-compat 当作 Desktop 插件安装通道（见 [community-plugins.md](../../docs/community-plugins.md)）。

---

# `@xrkseek/harness-desktop`

> **Audience**: Maintainers · Contributors

Private Electron desktop shell (workspace `apps/desktop`). Package **`@xrkseek/harness-desktop`**, **`private: true`**. Status in [status.md](../../docs/status.md) is **Unstable** (release packaging pipeline open; public ship / update channel credential-gated). Architecture: [ADR-0008](../../docs/adr/0008-desktop-shell-private-host.md).

The shell wraps the assembled XRK Web UI and opens **no** product Web listen port. The private Host (`@xrkseek/harness-desktop-host`) composes this repo’s Host / Face under an upstream-Node child; `xrk-app://` serves static assets and Fetch; framed pipes carry request/response bodies; Node IPC is **lifecycle-only**. Same-origin Host = same Face/session semantics as `xrkh web`.

**Integrated experience (vs Codex / Hermes / dsh combo)**: one install identity = shell + Desktop Host + Web dist + **same-origin Face** — Session-event SSOT, Status (session `costUsage` + cross-session cost-meter), honest Settings cards, `session.export` `cost.json` (with `dailyTrend`), and `xrkh doctor` `cost-ledger` probe, sharing `~/.xrk` — **not** a parallel ledger or Cordis-embedded Host. Day-to-day entry stays CLI / Web until status promotes to **Working**.

## Key decisions

| Decision | Meaning | Direct result |
|----------|---------|---------------|
| **Release identity** | Shell · Desktop Host · Web dist · plugin graph · bundled Node/pnpm (and seed later) share one Desktop release number | No “shell-only / runtime-only” split tracks; the public CLI line (`@xrkseek/harness-cli`) is **not** part of Desktop identity |
| **Runtime** | Packaged builds use bundled upstream Node + pinned pnpm; development projection may use caller Node (must be documented) | System pnpm / user npm config stay off the product execution path |
| **Transport** | No product listen; `xrk-app://` + framed pipes; IPC lifecycle-only | No fallback to a local HTTP `serve` second entry |
| **State ownership** | Share `~/.xrk` product data; isolate desktop profile · lock · `node_modules` · desktop pnpm store | CLI **must not** start/mutate `profiles/desktop`; single-instance lock is the primary owner |
| **Activation** | staging → health check → journaled activate → rollback / recover | `DesktopProfileTransactionManager`; ≠ offline seed installable |
| **Updates** | Update unit = shell + runtime + seed, same version; MVP = **full-package** + generic `app-update.yml`; `upload:desktop` validates + filesystem mirror | Blockmap differential / COS HTTPS PUT **phase 2** |
| **Plugin install** | Structured list/add/remove/update; fixed bundled-pnpm argv | ≠ CLI `xrkh plugin` / `web/boot.json` overlay / dsh-compat; `isDesktopPluginInstallReady()===false` |
| **Packaging targets** | Release matrix **`win-x64`** · **`mac-arm64`** · **`mac-x64`**; `package:desktop` + `upload:desktop`; `installerShipped=true` | Linux / win-arm64 **deferred**; live COS PUT **credential-gated**; day-1 entry stays CLI/Web |

## Layout

| Path | Role |
|------|------|
| `apps/desktop/src/` | Shell · packaging matrix · signing/update/upload (TypeScript source of truth) |
| `apps/desktop/scripts/` | electron-builder factory · prepare-runtime/package-set · `windows-sign.cmd` |
| `apps/desktop/.env.windows.example` / `.env.macos.example` | Local signing/update dotenv templates (copy to `.env.windows` / `.env.macos`; gitignored) |
| `apps/desktop-host` | Private Host entry (compose / Face; **no** Cordis boot) |
| `apps/web/dist` | Assembled product Web (`web:build` · `client:bundle` · `web:assemble`) |
| `.desktop-build/development/` | Development projection home · project · electron-user-data (isolated; ≠ `~/.xrk`) |
| `.desktop-build/downloads/` | Shared official Node archive cache (kept by default `pnpm clean:desktop`) |
| `.desktop-build/targets/<target>/runtime/` | Bundled Node + pnpm (`prepare:runtime`) |
| `.desktop-build/targets/<target>/artifacts/` | Signed installers + `package-complete-*.json` |
| `.desktop-build/targets/<target>/unsigned-artifacts/` | Unsigned NSIS (`-unsigned`; no embedded update feed) |
| `.desktop-build/upload-mirror/` · `upload-records/` | Local update-channel mirror + upload records (cleared by `clean:desktop`) |
| `~/.xrk/profiles/desktop` | Reserved Desktop profile (after packaged install) |

Protocol scheme: **`xrk-app`**. Renderer: `sandbox` + `contextIsolation` + `nodeIntegration: false`; preload exposes typed APIs only (locale · updates; plugin wiring phase 2).

## Development commands

Requires **Node ≥26** (same as root `engines`). Root scripts:

| Command | Role |
|---------|------|
| `pnpm build:desktop` | Build `desktop-host...` + Web assemble |
| `pnpm dev:desktop` | Run `build:desktop`, then try Electron (optional `electron`) |
| `pnpm start:desktop` | Skip build; needs existing `apps/desktop/dist` · `apps/desktop-host/dist` · `apps/web/dist` |
| `pnpm package:desktop` | Packaging pipeline: check/plan by default; `XRK_DESKTOP_PACKAGE=1` runs electron-builder |
| `pnpm upload:desktop` | Update-channel upload: `--check` validates plan; default mirrors via filesystem transport |
| `pnpm clean:desktop` | Clear artifacts/mirrors (keeps `downloads/` by default); `-- --all` also drops runtime |

Package scripts:

```bash
pnpm --filter @xrkseek/harness-desktop prepare:runtime [-- <win-x64|mac-arm64|mac-x64>]
pnpm --filter @xrkseek/harness-desktop prepare:package-set [-- <target>]
pnpm --filter @xrkseek/harness-desktop clean:build
```

Development projection does not download the bundled Node by default; use packaging prep paths to exercise bundled runtime / seed / plugin transactions. Day-to-day product config stays in **Settings UI**; Desktop does not invent a parallel settings source.

Related unit tests (`apps/desktop/tests`): single-instance · host-protocol · host-process · development projection · packaging target/path matrix · signing/update env · i18n key sets, etc. Shell copy: `src/locale.ts` (matching en+zh keys; English fallback for non-zh); `pnpm check` includes `verify-client-ui-i18n --desktop-only`.

## Packaging environment variables

| Variable | Role |
|----------|------|
| `XRK_HOME` (and server-config aliases) | Product Harness home; unpackaged default is isolated `.desktop-build/development/home` when unset |
| `XRK_DESKTOP_WEB_ROOT` | Override `xrk-app://` static root (default `apps/web/dist`) |
| `XRK_DESKTOP_TARGET` | Explicit packaging target: `win-x64` \| `mac-arm64` \| `mac-x64` |
| `XRK_DESKTOP_TARGET_PLATFORM` / `XRK_DESKTOP_TARGET_ARCH` | Platform/CPU override when deriving the target |
| `XRK_DESKTOP_PACKAGE=1` | Invoke electron-builder (default is pipeline check only) |
| `XRK_DESKTOP_UNSIGNED=1` | Unsigned Windows NSIS (`-unsigned` artifact name; no `app-update.yml`; win-x64 only; CLI wins over dotenv) |
| `XRK_DESKTOP_WINDOWS_*` | Windows token signing (`CER_FILE` · `SIGNTOOL` · `TOKEN_PIN` · `KEY_CONTAINER`). Fill `.env.windows` (from example) |
| `XRK_DESKTOP_MACOS_IDENTITY` / `APPLE_ID*` / `TEAM_ID` | macOS signing; notarize when Apple-id trio present (`.env.macos`) |
| `XRK_DESKTOP_AUTO_UPDATE_ENV` | `test` \| `production` (default test) |
| `XRK_DESKTOP_UPDATE_TEST_ORIGIN` / `XRK_DESKTOP_UPDATE_ORIGIN` | Generic update feed → `app-update.yml` (**omitted when unsigned**) |
| `XRK_DESKTOP_UPDATE_FORCE=1` | Force-enable update checks in development (still needs a resolvable feed) |
| `XRK_DESKTOP_UPDATE_CHECK_INTERVAL_MS` / `MAX_BACKOFF_MS` / `JITTER` | Auto-check interval · backoff cap · jitter (default 10m / 1h / 0.2) |
| `XRK_DESKTOP_UPLOAD_*` | Update-channel upload (bucket / secret; scrubbed from packaging; `pnpm upload:desktop`) |
| `ELECTRON_USER_DATA_DIR` | Electron userData (`dev:desktop` defaults to the development layout) |

Sources: `src/package-targets.ts` · `src/desktop-package-environment.ts` · `src/desktop-signing-environment.ts` · `src/windows-sign.ts` · `src/desktop-auto-update-environment.ts` · `src/update-coordinator.ts` · `src/update-schedule.ts` · `src/desktop-electron-updater.ts` · `src/desktop-upload-plan.ts` · `src/desktop-upload-run.ts` · `scripts/windows-sign.cmd` · `electron-builder.config.mjs`.

## Honesty

- Desktop is **Unstable** in [status.md](../../docs/status.md): packaging + update-upload CI are open (`installerShipped=true`); live COS PUT / public signed ship → **Working**.
- Default product entry is `xrkh web` / CLI. `pnpm package:desktop` no longer hard-refuses; `XRK_DESKTOP_PACKAGE=1` fails honestly without electron-builder.
- Seed: **development projection first**; offline seed / 16-shard **deferred** (ADR-0008 · `isDesktopOfflineSeedReady()`).
- Do not treat community client overlay / the dsh-compat capability table as the Desktop plugin install channel (see [community-plugins.md](../../docs/community-plugins.md)).
