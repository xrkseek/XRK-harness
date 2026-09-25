# ADR-0008: Desktop 壳与私有 Host 载体

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-09-10
- **Updated:** 2026-09-25
- **Tags:** desktop, electron, host, packaging, auto-update
- **Related:** [ADR-0001](./0001-typescript-only-host.md) · [ADR-0002](./0002-no-embed-upstream.md) · [status.md](../status.md) · [apps/desktop/README.md](../../apps/desktop/README.md)

## 背景

XRK-Harness 为自研产品栈；设计吸收 Codex 与业界 agent harness 在壳与 Host 交互上的长处，落点以本仓契约与代码为准。打包流水线对标 deepseek-harness `electron-builder`（unsigned 闸门 · 凭据签名 · generic 更新源 · build 时 `--publish never`）。

产品入口今日为 Web（`xrkh web` / `serve`）与 CLI（`@xrkseek/harness-cli`）。Electron 桌面载体由 workspace **`apps/desktop`**（`@xrkseek/harness-desktop`，**`private: true`**）与 **`apps/desktop-host`**（`@xrkseek/harness-desktop-host`，**private**）承载。

约束：[ADR-0001](./0001-typescript-only-host.md) Host 核心 TypeScript（Node ≥26）；[ADR-0002](./0002-no-embed-upstream.md) 禁止嵌 Cordis Host、禁止 vendor 外部宿主树。

## 决策

### 组成

| 部件 | 职责 | 落点 |
| --- | --- | --- |
| **Electron 壳** | 窗口 · 单实例锁 · `xrk-app://` · 分帧管道 · 窄 preload · 更新协调 | `apps/desktop` |
| **私有 Desktop Host** | 上游 Node 子进程；组合本仓 Host / Face / 已组装 Web；**无**监听 socket；**无** Cordis boot | `apps/desktop-host` |
| **产品数据** | 会话 · 设置 · 凭据 · 工作区 | `~/.xrk`（`XRK_HOME`） |
| **Desktop 可执行图** | profile · lock · `node_modules` · 内置 Node/pnpm store | `~/.xrk/profiles/desktop` · `~/.xrk/desktop/…` |

### 发布身份

一个 **Desktop 发布号**同时绑定：Electron 壳 · Desktop Host · 已组装 Web dist · 桌面插件依赖图 · 内置 Node/pnpm（及日后 seed）。**禁止**壳 / Host / Web dist / runtime 分轨升级；更新单元为整包 Desktop。CLI npm 线**不是** Desktop 身份的一部分，**不得**改写 `profiles/desktop`。

### 通信

| 通道 | 决策 |
| --- | --- |
| 产品 Web listen | **不开** — 无 `http(s)://127.0.0.1:…` 第二入口 |
| 自定义协议 | **`xrk-app://`** — 静态资源与 Renderer→Host Fetch |
| 分帧字节管道 | 壳 ↔ Host 主数据面（协议版本 · stream id · 背压 · cancel） |
| Node IPC | **仅** ready / fatal / shutdown 等生命周期信号 |

规则：不得回退「先 listen 再连 localhost」；Face wire 经协议 + 管道投影，不另起平行 REST 真源。**同源 Host** = 与 `xrkh web` 同一 compose/Face 语义，仅载体不同。

### 渲染安全

`sandbox` + `contextIsolation` + `nodeIntegration: false`；preload 仅类型化 API（locale · 更新；插件 CRUD 设计已钉、preload **二期**）。禁止暴露原始 ipc / fs / shell。

### 打包与签名（第一波已立项）

第一波目标：**`win-x64`**（NSIS）· **`mac-arm64`**（dmg + zip）。`mac-x64` · `win-arm64` · `linux-*` **暂缓**；非第一波 id 须拒绝。

| 能力 | 决策 |
| --- | --- |
| 打包闸门 | `pnpm package:desktop` **开放**第一波流水线（默认 `--check` 校验并写 `package-plan.json`）；`XRK_DESKTOP_PACKAGE=1` 调用 electron-builder |
| 默认产品入口 | **仍是** `xrkh web` / CLI；安装包不是 day-1 入口（`defaultEntry=cli-web`） |
| 未签名 Windows | `XRK_DESKTOP_UNSIGNED=1`（对标 dsh `DSH_DESKTOP_UNSIGNED`）；仅 win-x64 |
| Windows 真签 | `XRK_DESKTOP_WINDOWS_CER_FILE` 等；有证则 `forceCodeSigning`；准备子进程剥离签名 env |
| macOS 签名/公证 | `XRK_DESKTOP_MACOS_IDENTITY`；Apple-id 三件齐则 `notarize: true` |
| 自动更新 | MVP = **整包** + electron-updater generic；`XRK_DESKTOP_UPDATE_*_ORIGIN` → `app-update.yml`；build 时 `--publish never`；**上传流水线二期** |
| 产物目录 | `.desktop-build/targets/<target>/artifacts`（或 `unsigned-artifacts`） |

`isDesktopProductReady() === true` 表示**打包流水线就绪**（≠ 公开频道已发版；`installerShipped === false`）。

### Profile 事务 · 更新 · 插件 · Seed

- **Profile 事务**：`DesktopProfileTransactionManager` — staging → 健康检查 → 日记激活 → rollback / recover。
- **更新**：`DesktopUpdateCoordinator`；更新单元 = 壳 + runtime + seed 同版；MVP = **整包**；差分块 / 上传流水线 **二期**。
- **插件安装**（设计）：结构化 list/add/remove/update；`isDesktopPluginInstallReady() === false`。
- **Seed 策略**：MVP = **`development-projection`**（`dev:desktop`）；下一阶段 **`offline-seed`**。

### 明确不做

- 不把 Desktop 并入公共 `@xrkseek/harness-cli` 包表面。
- 不以本机 Web listen 为 Desktop 产品通信。
- 不在第一波实现 Linux、16 分片归档或公开 COS 上传流水线。
- 日常配置仍优先 **Settings UI**。

## 后果

- [status.md](../status.md)：**未稳**（第一波打包流水线可校验/可产包；公开签名发版与频道上传待凭据）→ **能跑**（至少一平台可分发安装包 + 更新频道接通）。
- 实现与测例须守：无产品 listen · IPC 不传业务 · CLI 拒绝 desktop profile · 同号发布绑定 · 默认入口不为安装包。
- 根脚本：`pnpm build:desktop` · `pnpm dev:desktop` · `pnpm start:desktop` · `pnpm package:desktop`。

## 开放项

- 生产更新源固定 origin 与 CI 凭据落点。
- 离线 seed：`store.tar` vs 目录 `store/`。
- 插件安装执行器与 preload `plugins` 接线。
- electron / electron-builder 作为 optionalDependencies：本机需显式装齐才能 `XRK_DESKTOP_PACKAGE=1` 产包。

---

# ADR-0008: Desktop shell and private Host carrier

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-09-10
- **Updated:** 2026-09-25
- **Tags:** desktop, electron, host, packaging, auto-update
- **Related:** [ADR-0001](./0001-typescript-only-host.md) · [ADR-0002](./0002-no-embed-upstream.md) · [status.md](../status.md) · [apps/desktop/README.md](../../apps/desktop/README.md)

## Context

XRK-Harness is an independently developed stack. Packaging follows deepseek-harness electron-builder patterns (unsigned gate · credential signing · generic update feed · `--publish never` at build).

Product entries today are Web (`xrkh web` / `serve`) and CLI. The Electron carrier lives in **`apps/desktop`** and **`apps/desktop-host`** (both private).

## Decision (packaging delta 2026-09-25)

- First-wave **`win-x64` / `mac-arm64`** packaging pipeline is **open** (`pnpm package:desktop`; produce with `XRK_DESKTOP_PACKAGE=1`).
- Default product entry remains **CLI/Web**; installer is never day-1 `xrkh` entry.
- Unsigned Windows via `XRK_DESKTOP_UNSIGNED=1`; signing/notarize when `XRK_DESKTOP_WINDOWS_*` / `XRK_DESKTOP_MACOS_*` present.
- Auto-update MVP: full-package + generic provider (`app-update.yml`); upload pipeline phase 2.
- Same-origin Host: Desktop Host composes the same Face/session stack as `xrkh web` (protocol + pipes, no listen).
- `isDesktopProductReady()` means packaging pipeline ready; `installerShipped` stays false until a public feed ships.

## Consequences

- status: **Unstable** until a distributable signed/notarized artifact + live update channel land; do not claim Working without them.
- See Chinese section above for the full composition / transport / security decisions (unchanged).
