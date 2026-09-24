# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x`）、**偶数预览**（如 `0.2.x`）。**不是** PATCH（第三位）；正式线上补丁按 `0.3.9` → `0.3.10` → `0.3.11` 顺序递增。

**例外（本版起）**：`MINOR=4` 预览线以 **v0.4.0** 收口——去掉 `-rc` 后缀的收口号**接管 `@latest`**，过程号 `rc.1`–`rc.4` 转为归档。下一档按约定进 **`MINOR=5` 正式线（`0.5.0`）**。

GitHub Release 公开页保留正式当前 + 上一正式线：

| 档                  | 版本                                                                                                      | 说明                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **当前（@latest）** | [v0.4.1](./v0.4.1.md)                                                                                     | `0.4.x` 线补丁号：易变层折叠进当前 user 消息尾缀（修「模型对着会话标记回话」）+ 中文链路接通 |
| **上一收口号**      | [v0.4.0](./v0.4.0.md)                                                                                     | `MINOR=4` 预览线**收口号**；内容仍有效，补丁见 v0.4.1                                        |
| **上一正式线**      | [v0.3.11](./v0.3.11.md)                                                                                   | `MINOR=3` 正式线；保留供对照与回退（`@0.3.11`）                                              |
| **过程号（归档）**  | [rc.1](./v0.4.0-rc.1.md) · [rc.2](./v0.4.0-rc.2.md) · [rc.3](./v0.4.0-rc.3.md) · [rc.4](./v0.4.0-rc.4.md) | `0.4.x` 线内的预发布号，npm dist-tag `rc`；内容已并入 v0.4.0，不推荐日常安装                 |
| **上一轮预览末号**  | [v0.2.7](./v0.2.7.md)                                                                                     | `MINOR=2` 预览线结束；对照留档                                                               |

对照：昔日正式 [v0.1.31](./v0.1.31.md) → [v0.3.10](./v0.3.10.md) → [v0.3.11](./v0.3.11.md) → 现 **v0.4.0**；预览线 **0.0.11**（已撤）→ 上一轮末号 **v0.2.7** → 本轮 **v0.4.0-rc.1…rc.4** → **v0.4.0**（收口并接管 `@latest`）。仓库内其余 `docs/releases/v*` 仍可查阅；npm 旧号以 deprecate 为准。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途                   | 命令                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| 当前（推荐）           | `npm i -g @xrkseek/harness-cli@latest`（= v0.4.0）后 `xrkh web`     |
| 精确锁版本             | `npm i -g @xrkseek/harness-cli@0.4.0` 后 `xrkh web`                 |
| 回退上一正式线         | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`                |
| 过程号（对照）         | `npm i -g @xrkseek/harness-cli@0.4.0-rc.4`，或 `@rc`；已并入 v0.4.0 |
| 上一轮预览末号（对照） | `npm i -g @xrkseek/harness-cli@0.2.7` 后 `xrkh web`                 |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x`), **even = preview** (e.g. `0.2.x`). **Not** the PATCH digit; on a formal line, patches increment sequentially (`0.3.9` → `0.3.10` → `0.3.11`).

**Exception (from this release)**: the `MINOR=4` preview line closes at **v0.4.0** — the suffix-free closing number **takes over `@latest`**, and the process numbers `rc.1`–`rc.4` become archives. The next line moves to the odd **`MINOR=5` formal train (`0.5.0`)**.

The GitHub Releases page keeps the current release plus the previous formal line:

| Line                           | Version                                                                                                   | Notes                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Current (@latest)**          | [v0.4.0](./v0.4.0.md)                                                                                     | **Closing number** of the `MINOR=4` preview line; `npm i -g @xrkseek/harness-cli@latest` resolves here |
| **Previous formal line**       | [v0.3.11](./v0.3.11.md)                                                                                   | `MINOR=3` formal line; kept for comparison and rollback (`@0.3.11`)                                    |
| **Process numbers (archived)** | [rc.1](./v0.4.0-rc.1.md) · [rc.2](./v0.4.0-rc.2.md) · [rc.3](./v0.4.0-rc.3.md) · [rc.4](./v0.4.0-rc.4.md) | Pre-releases inside the `0.4.x` line, npm dist-tag `rc`; merged into v0.4.0 — not for daily install    |
| **Previous preview line end**  | [v0.2.7](./v0.2.7.md)                                                                                     | `MINOR=2` preview line ended; archive only                                                             |

Succession: formal [v0.1.31](./v0.1.31.md) → [v0.3.10](./v0.3.10.md) → [v0.3.11](./v0.3.11.md) → now **v0.4.0**; preview **0.0.11** (withdrawn) → **v0.2.7** → **v0.4.0-rc.1…rc.4** → **v0.4.0** (closes the line and takes `@latest`). Other `docs/releases/v*` remain for reference; npm older numbers follow deprecate notices.

Install and publish: [publishing.md](../publishing.md).

## npm install cheat sheet

| Use                               | Command                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| Current (recommended)             | `npm i -g @xrkseek/harness-cli@latest` (= v0.4.0) then `xrkh web`        |
| Pin exactly                       | `npm i -g @xrkseek/harness-cli@0.4.0` then `xrkh web`                    |
| Roll back to previous formal line | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web`                   |
| Process numbers (archive)         | `npm i -g @xrkseek/harness-cli@0.4.0-rc.4`, or `@rc`; merged into v0.4.0 |
| Previous preview line end         | `npm i -g @xrkseek/harness-cli@0.2.7` then `xrkh web`                    |

Spec index: [docs/README.md](../README.md).
