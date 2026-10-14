# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x` · `0.5.x`）、**偶数预览**（如 `0.2.x` · `0.4.x`）。**不是** PATCH（第三位）。

**本版**：`MINOR=5` 正式线以 **v0.5.31** 为 npm `@latest`。预览线 **`0.6.x`** 起于 [v0.6.0-rc.1](./v0.6.0-rc.1.md)（npm `@rc`）。`0.4.x` 预览线已于 **v0.4.12** 收口。

| 档                  | 版本                                    | 说明                                                                 |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **当前（@latest）** | [v0.5.31](./v0.5.31.md)                 | `0.5.x` 正式线：**视觉工具结果带图 · 句柄文本 · 纯文本模型不再硬失败** |
| **预览（@rc）**     | [v0.6.0-rc.1](./v0.6.0-rc.1.md)         | `0.6.x` 首 rc：**归档减负 · 向阳/IM · 插件页重组 · 站立披露 · 分层记忆 · 社区热卸** |
| **上一正式补丁**    | [v0.5.30](./v0.5.30.md)                 | `0.5.x` 补丁：**拖放文件带源路径 · read_file 支持附件 id · 统计口径对齐 DSH** |
| **上一预览终态**    | [v0.4.12](./v0.4.12.md)                 | `0.4.x` 收口：Mux 超顶丢帧不掐线 · 心跳 5 miss                          |
| **上一正式线**      | [v0.3.11](./v0.3.11.md)                 | `MINOR=3`；npm 回退钉（`@0.3.11`）                                   |
| **收口号（文稿）**  | [v0.4.0](./v0.4.0.md)                   | 预览线收口；npm 已撤，见 GitHub Release                              |
| **过程号（文稿）**  | [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | 已并入；npm 已撤                                           |
| **上一轮预览（文稿）** | [v0.2.7](./v0.2.7.md)                | npm 已撤；GitHub 对照留档                                            |

对照：预览终态 [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.30](./v0.5.30.md) → 现 **v0.5.31**（`@latest`）；回退钉 **0.3.11**。仓库 `docs/releases/v*` 仍可查阅。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途           | 命令                                                            |
| -------------- | --------------------------------------------------------------- |
| 当前（推荐）   | `npm i -g @xrkseek/harness-cli@latest`（= v0.5.31）后 `xrkh web` |
| 预览（@rc）    | `npm i -g @xrkseek/harness-cli@rc`（= v0.6.0-rc.1）后 `xrkh web` |
| 精确锁版本     | `npm i -g @xrkseek/harness-cli@0.5.31` 后 `xrkh web`             |
| 回退上一正式线 | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`             |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x` · `0.5.x`), **even = preview** (e.g. `0.2.x` · `0.4.x`). **Not** the PATCH digit.

**This line**: `MINOR=5` formal packages currently at **v0.5.31** (npm `@latest`). Preview **`0.6.x`** starts at [v0.6.0-rc.1](./v0.6.0-rc.1.md) (npm `@rc`). The `0.4.x` preview line closed at **v0.4.12**.

| Slot | Version | Notes |
| ---- | ------- | ----- |
| **Current (@latest)** | [v0.5.31](./v0.5.31.md) | `0.5.x` formal: **vision tool results · image handle text · text-only routes stop hard-failing** |
| **Preview (@rc)** | [v0.6.0-rc.1](./v0.6.0-rc.1.md) | First `0.6.x` rc: **archive offload · Xiangyang/IM · Plugins reshape · standing disclosure · layered memory · live Host dispose** |
| **Prior formal patch** | [v0.5.30](./v0.5.30.md) | `0.5.x` patch: **drag/drop source paths · read_file attachment ids · DSH stats parity** |
| **Prior preview close** | [v0.4.12](./v0.4.12.md) | `0.4.x` close: Mux drop-over-budget without kill · 5-miss heartbeat |
| **Prior formal line** | [v0.3.11](./v0.3.11.md) | `MINOR=3`; npm rollback pin (`@0.3.11`) |

Trail: preview close [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.30](./v0.5.30.md) → current **v0.5.31** (`@latest`); rollback pin **0.3.11**. Older `docs/releases/v*` stay readable.

Install and publish: [publishing.md](../publishing.md).

## npm install cheat sheet

| Use | Command |
| --- | ------- |
| Current (recommended) | `npm i -g @xrkseek/harness-cli@latest` (= v0.5.31) then `xrkh web` |
| Preview (@rc) | `npm i -g @xrkseek/harness-cli@rc` (= v0.6.0-rc.1) then `xrkh web` |
| Exact pin | `npm i -g @xrkseek/harness-cli@0.5.31` then `xrkh web` |
| Rollback prior formal line | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web` |

Spec index: [docs/README.md](../README.md).
