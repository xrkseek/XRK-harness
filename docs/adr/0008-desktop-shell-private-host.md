# ADR-0008: Desktop 壳与私有 Host 载体

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-09-10
- **Updated:** 2026-09-29
- **Tags:** desktop, electron, host, packaging, auto-update
- **Related:** [ADR-0001](./0001-typescript-only-host.md) · [ADR-0002](./0002-no-embed-upstream.md) · [status.md](../status.md) · [apps/desktop/README.md](../../apps/desktop/README.md)

## 背景

XRK-Harness 为自研产品栈；设计吸收 Codex 与业界 agent harness 在壳与 Host 交互上的长处，落点以本仓契约与代码为准。打包流水线对标 deepseek-harness `electron-builder`（unsigned 闸门 · 凭据签名 · generic 更新源 · build 时 `--publish never`）。Desktop Face 载波对标 **DSH Desktop**（`127.0.0.1` 回环），避免 Electron 分帧管道与 Win32 ConPTY 的 HANDLE 继承冲突。

产品入口今日为 Web（`xrkh web` / `serve`）与 CLI（`@xrkseek/harness-cli`）。Electron 桌面载体由 workspace **`apps/desktop`**（`@xrkseek/harness-desktop`，**`private: true`**）与 **`apps/desktop-host`**（`@xrkseek/harness-desktop-host`，**private**）承载。

约束：[ADR-0001](./0001-typescript-only-host.md) Host 核心 TypeScript（Node ≥26）；[ADR-0002](./0002-no-embed-upstream.md) 禁止嵌 Cordis Host、禁止 vendor 外部宿主树。

## 决策

### 组成

| 部件 | 职责 | 落点 |
| --- | --- | --- |
| **Electron 壳** | 窗口 · 单实例锁 · `xrk-app://` 闪屏 · loopback `loadURL` · 窄 preload · 更新协调 | `apps/desktop` |
| **私有 Desktop Host** | 上游 Node 子进程；组合本仓 Host / Face / 已组装 Web；**listen `127.0.0.1` only**；**无** Cordis boot | `apps/desktop-host` |
| **产品数据** | 会话 · 设置 · 凭据 · 工作区 | `~/.xrk`（`XRK_HOME`） |
| **Desktop 可执行图** | profile · lock · `node_modules` · 内置 Node/pnpm store | `~/.xrk/profiles/desktop` · `~/.xrk/desktop/…` |

### 发布身份

一个 **Desktop 发布号**同时绑定：Electron 壳 · Desktop Host · 已组装 Web dist · 桌面插件依赖图 · 内置 Node/pnpm（及日后 seed）。**禁止**壳 / Host / Web dist / runtime 分轨升级；更新单元为整包 Desktop。CLI npm 线**不是** Desktop 身份的一部分，**不得**改写 `profiles/desktop`。

### 通信

| 通道 | 决策 |
| --- | --- |
| 产品 Web listen | **Desktop：仅 `127.0.0.1` 回环**（与 DSH Desktop 同构；**不**绑 `0.0.0.0` / 不暴露局域网） |
| 自定义协议 | **`xrk-app://`** — 可选 splash / 静态过渡；**产品 UI 以 Host 回环 origin 为准** |
| 分帧字节管道 | **退役**（曾为 Face 主数据面；Windows ConPTY 会继承 Electron 管道 HANDLE 并切断 Host） |
| Node IPC | **仅** ready（含 `origin`）/ fatal / shutdown 等生命周期信号 |

规则：Desktop Face = 回环 HTTP，与 `xrkh web` 同一 compose/Face 语义，仅载体不同；**禁止**把 Host 绑到非 loopback。CLI / `xrkh web` 仍可 listen 或按既有配置。

### 渲染安全

`sandbox` + `contextIsolation` + `nodeIntegration: false`；preload 仅类型化 API（locale · 更新；插件 CRUD 设计已钉、preload **二期**）。禁止暴露原始 ipc / fs / shell。

### 打包与签名（发布矩阵）

发布目标（对标最新 dsh）：**`win-x64`**（NSIS）· **`mac-arm64`**（dmg + zip）· **`mac-x64`**（dmg + zip；可在 Apple Silicon + Rosetta 或 Intel Mac 上构建）。`win-arm64` · `linux-*` **暂缓**；非发布矩阵 id 须拒绝。

| 能力 | 决策 |
| --- | --- |
| 打包闸门 | `pnpm package:desktop` **开放**发布流水线（默认 `--check` 校验并写 `package-plan.json`）；`XRK_DESKTOP_PACKAGE=1` 调用 electron-builder |
| 默认产品入口 | **仍是** `xrkh web` / CLI；安装包不是 day-1 入口（`defaultEntry=cli-web`） |
| 未签名 Windows | `XRK_DESKTOP_UNSIGNED=1`（对标 dsh `DSH_DESKTOP_UNSIGNED`）；仅 win-x64 |
| Windows 真签 | `XRK_DESKTOP_WINDOWS_CER_FILE` + `SIGNTOOL` + `TOKEN_PIN` + `KEY_CONTAINER`（SafeNet CSP；缺一不可）→ `forceCodeSigning` + `signtoolOptions.sign`；准备子进程 `scrubDesktopSigningEnvironment` |
| macOS 签名/公证 | `XRK_DESKTOP_MACOS_IDENTITY`；Apple-id 三件齐则 `notarize: true` |
| 自动更新 | MVP = **整包** + electron-updater generic；`XRK_DESKTOP_UPDATE_*_ORIGIN` → `app-update.yml`（**unsigned 不嵌入 feed**）；build 时 `--publish never`；Main 接 `DesktopUpdateCoordinator` + 定时检查 + 应用菜单「检查更新」；`pnpm upload:desktop` 校验产物并写本地镜像（COS HTTPS PUT 仍二期）；`pnpm clean:desktop` 清产物/镜像 |
| 产物目录 | `.desktop-build/targets/<target>/artifacts`（或 `unsigned-artifacts`）；产包成功写 `package-complete-<target>.json` |

`isDesktopProductReady() === true` 表示**打包 + 更新上传流水线就绪**（`installerShipped === true`；默认产品入口仍是 CLI/Web）。

### Profile 事务 · 更新 · 插件 · Seed

- **Profile 事务**：`DesktopProfileTransactionManager` — staging → 健康检查 → 日记激活 → rollback / recover。
- **更新**：`DesktopUpdateCoordinator`；更新单元 = 壳 + runtime + seed 同版；MVP = **整包**；差分块 / COS HTTPS PUT **二期**。
- **插件安装**（设计）：结构化 list/add/remove/update；`isDesktopPluginInstallReady() === false`。
- **Seed 策略**：MVP = **`development-projection`**（`dev:desktop`）；下一阶段 **`offline-seed`**。

### 明确不做

- 不把 Desktop 并入公共 `@xrkseek/harness-cli` 包表面。
- 不把 Desktop Host 绑到非 loopback（局域网 / `0.0.0.0`）。
- 不以 Electron 分帧管道做产品 Face 数据面（Windows ConPTY 会继承 HANDLE）。
- 不在本波实现 Linux、16 分片归档或实网 COS HTTPS PUT（本地文件系统镜像上传已开）。
- 日常配置仍优先 **Settings UI**。

## 后果

- [status.md](../status.md)：打包 + 更新上传流水线可校验；Desktop Face = **`127.0.0.1` 回环**（对标 DSH Desktop）。
- 实现与测例须守：loopback-only listen · IPC 不传业务 · CLI 拒绝 desktop profile · 同号发布绑定 · 默认入口不为安装包。
- 根脚本：`pnpm build:desktop` · `pnpm dev:desktop` · `pnpm start:desktop` · `pnpm package:desktop` · `pnpm upload:desktop` · `pnpm clean:desktop`。

## 开放项

- 生产更新源固定 origin 与 CI 凭据落点（HTTPS PUT transport）。
- 离线 seed：`store.tar` vs 目录 `store/`。
- 插件安装执行器与 preload `plugins` 接线。
- electron / electron-builder 作为 optionalDependencies：本机需显式装齐才能 `XRK_DESKTOP_PACKAGE=1` 产包。

---

> **Updated 2026-09-29**：Desktop Face 从 Electron 分帧管道改为 **`127.0.0.1` 回环 HTTP**（对标 dataelement/dsh-desktop）。管道方案下 Win32 ConPTY 会继承 Face/IPC HANDLE，一开终端就切断 Host。

---

# ADR-0008: Desktop shell and private Host carrier

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-09-10
- **Updated:** 2026-09-29
- **Tags:** desktop, electron, host, packaging, auto-update
- **Related:** [ADR-0001](./0001-typescript-only-host.md) · [ADR-0002](./0002-no-embed-upstream.md) · [status.md](../status.md) · [apps/desktop/README.md](../../apps/desktop/README.md)

## Context

XRK-Harness is an independently developed stack. Packaging follows deepseek-harness electron-builder patterns (unsigned gate · credential signing · generic update feed · `--publish never` at build).

Product entries today are Web (`xrkh web` / `serve`) and CLI. The Electron carrier lives in **`apps/desktop`** and **`apps/desktop-host`** (both private).

## Decision (packaging + Face carrier 2026-09-29)

- Release matrix **`win-x64` / `mac-arm64` / `mac-x64`** packaging pipeline is **open** (`pnpm package:desktop`; produce with `XRK_DESKTOP_PACKAGE=1`). `mac-x64` may build on Apple Silicon (Rosetta) or Intel Mac. `win-arm64` / `linux-*` remain deferred.
- Default product entry remains **CLI/Web**; installer is never day-1 `xrkh` entry.
- Unsigned Windows via `XRK_DESKTOP_UNSIGNED=1`; signing/notarize when `XRK_DESKTOP_WINDOWS_*` / `XRK_DESKTOP_MACOS_*` present.
- Auto-update MVP: full-package + generic provider (`app-update.yml`; **omitted for unsigned**); Main wires `DesktopUpdateCoordinator` + schedule + application-menu check; `pnpm upload:desktop` validates artifacts + `package-complete-*.json` and mirrors to a local filesystem transport (live COS HTTPS PUT remains phase 2); `pnpm clean:desktop` clears artifacts/mirrors.
- `installerShipped=true` once the update upload CI path exists; day-1 entry stays `cli-web`.
- **Desktop Face carrier: `http://127.0.0.1:<ephemeral>`** (DSH Desktop posture). Node IPC carries only lifecycle (`ready` includes `origin`). Framed Electron Face pipes are retired — Win32 ConPTY inherited those HANDLEs and killed Host on first terminal open.
- `isDesktopProductReady()` means packaging + update-upload pipeline ready.
- Builder identity lives in one `DESKTOP_BUILDER_CONFIG` (no draft alias); upload credentials stay scrubbed from package-prep subprocesses.

## Consequences

- status tracks packaging + update-upload; Desktop Face is loopback-only.
- See Chinese section above for composition / transport / security decisions.
- Implementation must keep: loopback-only listen · IPC lifecycle-only · CLI refuses desktop profile · same release identity · default entry is not the installer.