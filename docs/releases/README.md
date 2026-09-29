# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x` · `0.5.x`）、**偶数预览**（如 `0.2.x` · `0.4.x`）。**不是** PATCH（第三位）。

**本版**：`MINOR=5` 正式线以 **v0.5.0** 为 npm `@latest`；`0.4.x` 预览线已于 **v0.4.12** 收口。npmjs **仅保留 0.5.0 与 0.3.11**；GitHub Release 文稿可保留历史号。

| 档                  | 版本                                    | 说明                                                                 |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **当前（@latest）** | [v0.5.0](./v0.5.0.md)                   | `0.5.x` 正式线首发：Desktop loopback Face · Host 并行 · 插件清单/定时 · 概况/工具卡 · dsh-compat · reasoning |
| **上一预览终态**    | [v0.4.12](./v0.4.12.md)                 | `0.4.x` 收口：Mux 超顶丢帧不掐线 · 心跳 5 miss                          |
| **上一正式线**      | [v0.3.11](./v0.3.11.md)                 | `MINOR=3`；npm 回退钉（`@0.3.11`）                                   |
| **收口号（文稿）**  | [v0.4.0](./v0.4.0.md)                   | 预览线收口；npm 已撤，见 GitHub Release                              |
| **过程号（文稿）**  | [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | 已并入；npm 已撤                                           |
| **上一轮预览（文稿）** | [v0.2.7](./v0.2.7.md)                | npm 已撤；GitHub 对照留档                                            |

对照：预览终态 [v0.4.12](./v0.4.12.md) → 现 **v0.5.0**（`@latest`）；回退钉 **0.3.11**。仓库 `docs/releases/v*` 仍可查阅。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途           | 命令                                                            |
| -------------- | --------------------------------------------------------------- |
| 当前（推荐）   | `npm i -g @xrkseek/harness-cli@latest`（= v0.5.0）后 `xrkh web` |
| 精确锁版本     | `npm i -g @xrkseek/harness-cli@0.5.0` 后 `xrkh web`             |
| 回退上一正式线 | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`             |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x` · `0.5.x`), **even = preview** (e.g. `0.2.x` · `0.4.x`). **Not** the PATCH digit.

**This release**: the `MINOR=5` formal line opens on npm `@latest` at **v0.5.0**; the `0.4.x` preview line closed at **v0.4.12**. npmjs **keeps only 0.5.0 and 0.3.11**; GitHub Release notes may retain historical tags.

| Line                      | Version                                   | Notes                                                                                          |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Current (@latest)**     | [v0.5.0](./v0.5.0.md)                     | `0.5.x` formal open: Desktop loopback Face · Host attach · plugin inventory/schedule · Overview/tool cards · dsh-compat · reasoning |
| **Prior preview close**   | [v0.4.12](./v0.4.12.md)                   | `0.4.x` close-out: Mux drop-not-terminate · 5-miss heartbeat                                   |
| **Previous formal line**  | [v0.3.11](./v0.3.11.md)                   | `MINOR=3`; npm rollback pin (`@0.3.11`)                                                        |
| **Closing number (docs)** | [v0.4.0](./v0.4.0.md)                     | Preview-line close; withdrawn from npm; see GitHub Release                                     |
| **Process numbers (docs)**| [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | Folded in; withdrawn from npm                                                        |
| **Prior preview (docs)**  | [v0.2.7](./v0.2.7.md)                     | Withdrawn from npm; GitHub archive only                                                        |

Succession: preview close [v0.4.12](./v0.4.12.md) → now **v0.5.0** (`@latest`); rollback pin **0.3.11**. Other `docs/releases/v*` remain for reference.

## npm install cheat sheet

| Use                           | Command                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| Current (recommended)         | `npm i -g @xrkseek/harness-cli@latest` (= v0.5.0) then `xrkh web`   |
| Pin exactly                   | `npm i -g @xrkseek/harness-cli@0.5.0` then `xrkh web`               |
| Roll back previous formal     | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web`               |

Spec index: [docs/README.md](../README.md).
