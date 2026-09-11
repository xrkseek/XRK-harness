# ADR-0008: Desktop 壳与私有 Host 载体

> **读者**：维护者 · 贡献者

- **Status:** Proposed
- **Date:** 2026-09-10
- **Updated:** 2026-09-11
- **Tags:** desktop, electron, host, packaging
- **Related:** [ADR-0001](./0001-typescript-only-host.md) · [ADR-0002](./0002-no-embed-upstream.md) · [status.md](../status.md) · [apps/desktop/README.md](../../apps/desktop/README.md)

## 背景

XRK-Harness 为自研产品栈；设计吸收 Codex 与业界 agent harness 在壳与 Host 交互上的长处，落点以本仓契约与代码为准。

产品入口今日为 Web（`xrkh web` / `serve`）与 CLI（`@xrkseek/harness-cli`）。Electron 桌面载体由 workspace **`apps/desktop`**（`@xrkseek/harness-desktop`，**`private: true`**，不进公共 npm）与 **`apps/desktop-host`**（`@xrkseek/harness-desktop-host`，**private**）承载。

[status.md](../status.md) 登记 Desktop 整包为 **未做**（`build:desktop` 可过、安装包未做；脚本与单测 ≠ 整包可跑）。本 ADR 在实现推进前固定架构，避免与 CLI 线、Web 壳混轨。

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

规则：不得回退「先 listen 再连 localhost」；Face wire 经协议 + 管道投影，不另起平行 REST 真源。

### 渲染安全

`sandbox` + `contextIsolation` + `nodeIntegration: false`；preload 仅类型化 API（locale · 更新；插件 CRUD 设计已钉、preload **二期**）。禁止暴露原始 ipc / fs / shell。壳文案 `locale.ts`；`verify-client-ui-i18n --desktop-only` 纳入 `pnpm check`。

### 状态归属

**共享**：`~/.xrk` 会话 · Settings · 凭据 · 工作区。**隔离**：desktop profile · lock · `node_modules` · 桌面 pnpm store。CLI `web`/`serve`/`plugin` **不得**启动或改写 `profiles/desktop`；单实例锁为 owner。开发投影使用 `apps/desktop/.desktop-build/development/`，默认与用户 `~/.xrk` 隔离。

### Desktop Host 入口

`apps/desktop-host` 以本仓 **`@xrkseek/compose` · presets · Face wire · `serve` 装配**为组合真源；**禁止** Cordis boot / overlay。与 CLI 共享 Face / session 语义；差异仅在载体（协议 + 管道 vs HTTP listen）。

### 打包与 runtime

第一波目标：**`win-x64`**（NSIS）· **`mac-arm64`**（dmg + zip）。`mac-x64` · `win-arm64` · `linux-*` **暂缓**；真签 / 公证 / 发版流水线 **未做**。非第一波 id 须拒绝。

`prepare-runtime`：捆绑 Node **`v26.8.1`** + pnpm **`11.22.0`** → `.desktop-build/targets/<target>/runtime/`。开发投影不强制下载捆绑 Node。

`prepare-package-set`：第一方 tarball + `desktop-packages.json` + seed `integrity.json`；**不**等于离线 store 已就绪（`isDesktopOfflineSeedReady() === false`）。

### Profile 事务 · 更新 · 插件 · Seed

- **Profile 事务**：`DesktopProfileTransactionManager` — staging → 健康检查 → 日记激活 → rollback / recover；≠ 离线 seed 可装。
- **更新**：`DesktopUpdateCoordinator` 骨架；更新单元 = 壳 + runtime + seed 同版；MVP = **整包**；差分块 / 上传流水线 **二期**。
- **插件安装**（设计）：结构化 `list` / `add` / `remove` / `update` + 内置 pnpm 固定 argv；`isDesktopPluginInstallReady() === false`；≠ CLI `xrkh plugin` / 社区 client web overlay。
- **Seed 策略**：MVP = **`development-projection`**（`dev:desktop`）；下一阶段 **`offline-seed`**（已设计 / 未实现）。16 分片 store · CAS 公证 **暂缓**。

### 明确不做

- 不把 Desktop 并入公共 `@xrkseek/harness-cli` 包表面。
- 不以本机 Web listen 为 Desktop 产品通信。
- 不在 MVP 实现 Linux 第一波、16 分片归档或完整签名 / 自动更新流水线。
- 日常配置仍优先 **Settings UI**；Desktop 无平行设置真源。

## 后果

- [status.md](../status.md) 分阶段：**未做**（当前）→ **未稳**（`dev:desktop` 开发投影可跑）→ **能跑**（第一波打包产物可用）；禁止跳级。
- 实现与测例须守：无产品 listen · IPC 不传业务 · CLI 拒绝 desktop profile · 同号发布绑定。
- 分帧管道 **v1**：魔数 `XRK1` · 13 字节头 · data ≤ 64KiB；编解码在 `@xrkseek/harness-desktop`，Host 经 `wire` 导出。
- 根脚本：`pnpm build:desktop` · `pnpm dev:desktop` · `pnpm start:desktop`（见 [apps/desktop/README.md](../../apps/desktop/README.md)）。

## 开放项

- 第一波签名 / 公证凭据与更新 `publish` URL 落点。
- 离线 seed：`store.tar` vs 目录 `store/` 体积取舍。
- 插件安装执行器与 preload `plugins` 接线。

---

# ADR-0008: Desktop shell and private Host carrier

> **Audience**: Maintainers · Contributors

- **Status:** Proposed
- **Date:** 2026-09-10
- **Updated:** 2026-09-11
- **Tags:** desktop, electron, host, packaging
- **Related:** [ADR-0001](./0001-typescript-only-host.md) · [ADR-0002](./0002-no-embed-upstream.md) · [status.md](../status.md) · [apps/desktop/README.md](../../apps/desktop/README.md)

## Context

XRK-Harness is an independently developed stack. Design absorbs strengths from Codex and peer agent harnesses in shell–Host interaction; contracts and code in this repo are authoritative.

Product entries today are Web (`xrkh web` / `serve`) and CLI (`@xrkseek/harness-cli`). The Electron desktop carrier lives in workspace **`apps/desktop`** (`@xrkseek/harness-desktop`, **`private: true`**, not on public npm) and **`apps/desktop-host`** (`@xrkseek/harness-desktop-host`, **private**).

[status.md](../status.md) lists the Desktop full package as **Not done** (`build:desktop` passes; installer not shipped; scripts and unit tests ≠ a runnable package). This ADR locks architecture before implementation so Desktop does not mix tracks with the CLI or Web shell lines.

Constraints: [ADR-0001](./0001-typescript-only-host.md) keeps the Host core TypeScript (Node ≥26); [ADR-0002](./0002-no-embed-upstream.md) forbids embedding a Cordis Host and vendoring external host trees.

## Decision

### Composition

| Part | Role | Landing |
| --- | --- | --- |
| **Electron shell** | Windows · single-instance lock · `xrk-app://` · framed pipes · narrow preload · update coordination | `apps/desktop` |
| **Private Desktop Host** | Upstream-Node child; compose this repo’s Host / Face / assembled Web; **no** listen socket; **no** Cordis boot | `apps/desktop-host` |
| **Product data** | Sessions · settings · credentials · workspaces | `~/.xrk` (`XRK_HOME`) |
| **Desktop executable graph** | Profile · lock · `node_modules` · bundled Node/pnpm store | `~/.xrk/profiles/desktop` · `~/.xrk/desktop/…` |

### Release identity

One **Desktop release number** binds: Electron shell · Desktop Host · assembled Web dist · desktop plugin dependency graph · bundled Node/pnpm (and seed later). **Forbidden:** split-track upgrades of shell / Host / Web dist / runtime; the update unit is the full Desktop release. The CLI npm line is **not** part of Desktop identity and **must not** mutate `profiles/desktop`.

### Transport

| Channel | Decision |
| --- | --- |
| Product Web listen | **None** — no `http(s)://127.0.0.1:…` second entry |
| Custom protocol | **`xrk-app://`** — static assets and Renderer→Host Fetch |
| Framed byte pipes | Shell ↔ Host primary data plane (protocol version · stream id · backpressure · cancel) |
| Node IPC | **Lifecycle only** — ready / fatal / shutdown and equivalent control signals |

Rules: no fallback to “listen first, then point the window at localhost”; Face wire projects over protocol + pipes — no parallel REST source of truth.

### Renderer security

`sandbox` + `contextIsolation` + `nodeIntegration: false`; preload exposes typed APIs only (locale · updates; plugin CRUD **designed**, preload **phase 2**). No raw ipc / fs / shell. Shell copy in `locale.ts`; `verify-client-ui-i18n --desktop-only` is part of `pnpm check`.

### State ownership

**Shared:** `~/.xrk` sessions · Settings · credentials · workspaces. **Isolated:** desktop profile · lock · `node_modules` · desktop pnpm store. CLI `web`/`serve`/`plugin` **must not** start or mutate `profiles/desktop`; the single-instance lock is the owner. Development projection uses `apps/desktop/.desktop-build/development/`, isolated from the user’s `~/.xrk` by default.

### Desktop Host entry

`apps/desktop-host` composes via this repo’s **`@xrkseek/compose` · presets · Face wire · `serve` assembly**; **no** Cordis boot / overlay. Desktop and CLI share Face / session semantics; the difference is the carrier (protocol + pipes vs HTTP listen).

### Packaging and runtime

First-wave targets: **`win-x64`** (NSIS) · **`mac-arm64`** (dmg + zip). `mac-x64` · `win-arm64` · `linux-*` **deferred**; real signing / notarization / ship pipeline **not done**. Non–first-wave ids must reject.

`prepare-runtime`: bundle Node **`v26.8.1`** + pnpm **`11.22.0`** → `.desktop-build/targets/<target>/runtime/`. Development projection does not require downloading the bundled Node.

`prepare-package-set`: first-party tarballs + `desktop-packages.json` + seed `integrity.json`; **≠** offline store ready (`isDesktopOfflineSeedReady() === false`).

### Profile transaction · updates · plugins · seed

- **Profile transaction:** `DesktopProfileTransactionManager` — staging → health check → journaled activate → rollback / recover; ≠ installable offline seed.
- **Updates:** `DesktopUpdateCoordinator` skeleton; update unit = shell + runtime + seed same version; MVP = **full-package**; blockmap differential / upload pipeline **phase 2**.
- **Plugin install** (design): structured `list` / `add` / `remove` / `update` + fixed bundled-pnpm argv; `isDesktopPluginInstallReady() === false`; ≠ CLI `xrkh plugin` / community client web overlay.
- **Seed strategy:** MVP = **`development-projection`** (`dev:desktop`); next **`offline-seed`** (designed / not implemented). 16-shard store · CAS notarization **deferred**.

### Explicitly out of scope

- Do not fold Desktop into the public `@xrkseek/harness-cli` package surface.
- Do not use a local Web listen as Desktop product transport.
- Do not ship Linux in the first wave, 16-shard archives, or a full signing / auto-update pipeline in the MVP.
- Day-to-day configuration stays in **Settings UI**; Desktop does not invent a parallel settings source.

## Consequences

- [status.md](../status.md) phases: **Not done** (current) → **Unstable** (`dev:desktop` development projection runs) → **Working** (first-wave packaged artifacts usable); no skip-ahead claims.
- Implementations and tests must enforce: no product listen · no business on IPC · CLI refuses desktop profile · same-number release binding.
- Framed pipe **v1**: magic `XRK1` · 13-byte header · data ≤ 64KiB; codec in `@xrkseek/harness-desktop`, Host re-exports via `wire`.
- Root scripts: `pnpm build:desktop` · `pnpm dev:desktop` · `pnpm start:desktop` (see [apps/desktop/README.md](../../apps/desktop/README.md)).

## Open questions

- Where first-wave signing / notarization credentials and update `publish` URLs land.
- Offline seed: `store.tar` vs directory `store/` size trade-off.
- Plugin install executor and preload `plugins` wiring.
