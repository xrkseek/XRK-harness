# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x` · `0.5.x`）、**偶数预览**（如 `0.2.x` · `0.4.x`）。**不是** PATCH（第三位）。

**本版**：`MINOR=5` 正式线以 **v0.5.14** 为当前包号（npm `@latest`）。`0.4.x` 预览线已于 **v0.4.12** 收口。

| 档                  | 版本                                    | 说明                                                                 |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **当前（本机包）**  | [v0.5.14](./v0.5.14.md)                 | `0.5.x` 补丁：**Desktop 应用内更新对话框与进度** · 发现新版本即预下载 · Settings 底栏与 Host 重连同槽 |
| **上一正式补丁**    | [v0.5.13](./v0.5.13.md)                 | `0.5.x` 补丁：**ripgrep 搜索后端** · **read 按 maxBytes 前缀读盘** · 后台 job **256KiB 尾 + spill 整段恢复** · 子进程降优先级 / 管道让路 · mux **按会话公平写出** · **产品家目录可读写** · 委派方 seat 跟主线节拍 · 设置行细粒度订阅 |
| **上一预览终态**    | [v0.4.12](./v0.4.12.md)                 | `0.4.x` 收口：Mux 超顶丢帧不掐线 · 心跳 5 miss                          |
| **上一正式线**      | [v0.3.11](./v0.3.11.md)                 | `MINOR=3`；npm 回退钉（`@0.3.11`）                                   |
| **收口号（文稿）**  | [v0.4.0](./v0.4.0.md)                   | 预览线收口；npm 已撤，见 GitHub Release                              |
| **过程号（文稿）**  | [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | 已并入；npm 已撤                                           |
| **上一轮预览（文稿）** | [v0.2.7](./v0.2.7.md)                | npm 已撤；GitHub 对照留档                                            |

对照：预览终态 [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.12](./v0.5.12.md) → [v0.5.13](./v0.5.13.md) → 现 **v0.5.14**（`@latest`）；回退钉 **0.3.11**。仓库 `docs/releases/v*` 仍可查阅。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途           | 命令                                                            |
| -------------- | --------------------------------------------------------------- |
| 当前（推荐）   | `npm i -g @xrkseek/harness-cli@latest`（= v0.5.14）后 `xrkh web` |
| 精确锁版本     | `npm i -g @xrkseek/harness-cli@0.5.14` 后 `xrkh web`             |
| 回退上一正式线 | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`             |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x` · `0.5.x`), **even = preview** (e.g. `0.2.x` · `0.4.x`). **Not** the PATCH digit.

**This release**: the `MINOR=5` formal line is at **v0.5.14** as the current package number (npm `@latest`). The `0.4.x` preview line closed at **v0.4.12**.

| Line                      | Version                                   | Notes                                                                                          |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Current (local build)** | [v0.5.14](./v0.5.14.md)                   | `0.5.x` patch: **in-app Desktop update dialog and progress** · prefetch when the feed is newer · Settings foot shares the Host reconnect slot |
| **Prior formal patch**    | [v0.5.13](./v0.5.13.md)                   | `0.5.x` patch: **ripgrep search backend** · **read prefix-capped by maxBytes** · background job **256 KiB tail + spill recovery** · below-normal children / pipe yielding · mux **fair per-session send** · **product home readable and writable** · 委派方 seat follows the home beat · per-field settings subscriptions |
| **Prior preview close**   | [v0.4.12](./v0.4.12.md)                   | `0.4.x` close-out: Mux drop-not-terminate · 5-miss heartbeat                                   |
| **Previous formal line**  | [v0.3.11](./v0.3.11.md)                   | `MINOR=3`; npm rollback pin (`@0.3.11`)                                                        |
| **Closing number (docs)** | [v0.4.0](./v0.4.0.md)                     | Preview-line close; withdrawn from npm; see GitHub Release                                     |
| **Process numbers (docs)**| [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | Folded in; withdrawn from npm                                                        |
| **Prior preview (docs)**  | [v0.2.7](./v0.2.7.md)                     | Withdrawn from npm; GitHub archive only                                                        |

Succession: preview close [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.12](./v0.5.12.md) → [v0.5.13](./v0.5.13.md) → now **v0.5.14** (`@latest`); rollback pin **0.3.11**. Other `docs/releases/v*` remain for reference.

## npm install cheat sheet

| Use                           | Command                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| Current (recommended)         | `npm i -g @xrkseek/harness-cli@latest` (= v0.5.14) then `xrkh web` |
| Pin exactly                   | `npm i -g @xrkseek/harness-cli@0.5.14` then `xrkh web`               |
| Roll back previous formal     | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web`               |

Spec index: [docs/README.md](../README.md).
