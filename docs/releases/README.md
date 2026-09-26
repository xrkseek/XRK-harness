# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x`）、**偶数预览**（如 `0.2.x` · `0.4.x`）。**不是** PATCH（第三位）。

**本版**：`MINOR=4` 预览线以 **v0.4.12** 为 npm `@latest` 终态；下一档进 **`MINOR=5` 正式线（`0.5.0`）**。npmjs **仅保留 0.4.12 与 0.3.11**；GitHub Release 文稿可保留历史号。

| 档                  | 版本                                    | 说明                                                                 |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **当前（@latest）** | [v0.4.12](./v0.4.12.md)                 | `0.4.x` 终态：Mux 超顶丢帧不掐线 · 心跳 5 miss · npm 只留本号+0.3.11 |
| **上一补丁**        | [v0.4.11](./v0.4.11.md)                 | Mux 队列软顶（曾超顶 terminate）· 冷会话跳过 hydrate                 |
| **上一正式线**      | [v0.3.11](./v0.3.11.md)                 | `MINOR=3`；npm 回退钉（`@0.3.11`）                                   |
| **收口号（文稿）**  | [v0.4.0](./v0.4.0.md)                   | 预览线收口；npm 已撤，见 GitHub Release                              |
| **过程号（文稿）**  | [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | 已并入；npm 已撤                                           |
| **上一轮预览（文稿）** | [v0.2.7](./v0.2.7.md)                | npm 已撤；GitHub 对照留档                                            |

对照：正式 [v0.3.11](./v0.3.11.md) → 现 **v0.4.12**（`@latest`）；下一档 **0.5.x**。仓库 `docs/releases/v*` 仍可查阅。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途           | 命令                                                            |
| -------------- | --------------------------------------------------------------- |
| 当前（推荐）   | `npm i -g @xrkseek/harness-cli@latest`（= v0.4.12）后 `xrkh web` |
| 精确锁版本     | `npm i -g @xrkseek/harness-cli@0.4.12` 后 `xrkh web`             |
| 回退上一正式线 | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`             |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x`), **even = preview** (e.g. `0.2.x` · `0.4.x`). **Not** the PATCH digit.

**This release**: the `MINOR=4` preview line closes on npm `@latest` at **v0.4.12**; the next train is **`MINOR=5` formal (`0.5.0`)**. npmjs **keeps only 0.4.12 and 0.3.11**; GitHub Release notes may retain historical tags.

| Line                      | Version                                   | Notes                                                                                          |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Current (@latest)**     | [v0.4.12](./v0.4.12.md)                   | `0.4.x` close-out: Mux drop-not-terminate · 5-miss heartbeat · npm keeps this + 0.3.11 only   |
| **Previous patch**        | [v0.4.11](./v0.4.11.md)                   | Mux queue soft caps (over-budget terminate) · cold hydrate skip                                |
| **Previous formal line**  | [v0.3.11](./v0.3.11.md)                   | `MINOR=3`; npm rollback pin (`@0.3.11`)                                                        |
| **Closing number (docs)** | [v0.4.0](./v0.4.0.md)                     | Preview-line close; withdrawn from npm; see GitHub Release                                     |
| **Process numbers (docs)**| [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | Folded in; withdrawn from npm                                                        |
| **Prior preview (docs)**  | [v0.2.7](./v0.2.7.md)                     | Withdrawn from npm; GitHub archive only                                                        |

Succession: formal [v0.3.11](./v0.3.11.md) → now **v0.4.12** (`@latest`); next **0.5.x**. Other `docs/releases/v*` remain for reference.

## npm install cheat sheet

| Use                           | Command                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| Current (recommended)         | `npm i -g @xrkseek/harness-cli@latest` (= v0.4.12) then `xrkh web`   |
| Pin exactly                   | `npm i -g @xrkseek/harness-cli@0.4.12` then `xrkh web`               |
| Roll back previous formal     | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web`               |

Spec index: [docs/README.md](../README.md).
