# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x` · `0.5.x`）、**偶数预览**（如 `0.2.x` · `0.4.x`）。**不是** PATCH（第三位）。

**本版**：`0.6.x` 线当前版本 **v0.6.16**（补丁文稿；发包后接管 npm `@latest`）；上一补丁 [v0.6.15](./v0.6.15.md)、收口号 [v0.6.0](./v0.6.0.md) 与同线过程号 [v0.6.0-rc.1](./v0.6.0-rc.1.md) · [v0.6.0-rc.2](./v0.6.0-rc.2.md) 保留留档（npm `@rc` 停在 rc.2）。上一正式线 **v0.5.31** 退为上一版。`0.4.x` 预览线已于 **v0.4.12** 收口。

| 档                  | 版本                                    | 说明                                                                 |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **当前（@latest）** | [v0.6.16](./v0.6.16.md)                 | `0.6.x` 补丁：**OpenCode Zen/Go 会话头 · 失败真因 · 写锁回收 · Desktop OOM** |
| **上一补丁**        | [v0.6.15](./v0.6.15.md)                 | `0.6.x` 补丁：**归档确认 · 限时倒计时 · 干员权威首行 · 站立 authority** |
| **上一补丁（前）**  | [v0.6.14](./v0.6.14.md)                 | `0.6.x` 补丁：**完成通知 · Host 错位刷新 · 限时提问 · 归档准入 · spill · 紧凑侧栏** |
| **本线收口号**      | [v0.6.0](./v0.6.0.md)                   | `0.6.x` 收口：**归档减负 · 向阳/IM 编排 · 插件页重组 · 站立披露 · 分层记忆 · 多工作区 cwd 狱 · 搜索同路径闸** |
| **过程号（文稿）**  | [v0.6.0-rc.2](./v0.6.0-rc.2.md) · [rc.1](./v0.6.0-rc.1.md) | 预览热修与首 rc；已并入本线 |
| **上一正式线**      | [v0.5.31](./v0.5.31.md)                 | `0.5.x` 正式线：**视觉工具结果带图 · 句柄文本 · 纯文本模型不再硬失败** |
| **上一正式补丁**    | [v0.5.30](./v0.5.30.md)                 | `0.5.x` 补丁：**拖放文件带源路径 · read_file 支持附件 id · 统计口径对齐 DSH** |
| **上一预览终态**    | [v0.4.12](./v0.4.12.md)                 | `0.4.x` 收口：Mux 超顶丢帧不掐线 · 心跳 5 miss                          |
| **回退钉**          | [v0.3.11](./v0.3.11.md)                 | `MINOR=3`；npm 回退钉（`@0.3.11`）                                   |
| **收口号（文稿）**  | [v0.4.0](./v0.4.0.md)                   | 预览线收口；npm 已撤，见 GitHub Release                              |
| **过程号（文稿）**  | [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | 已并入；npm 已撤                                           |
| **上一轮预览（文稿）** | [v0.2.7](./v0.2.7.md)                | npm 已撤；GitHub 对照留档                                            |

对照：预览终态 [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.31](./v0.5.31.md) → [v0.6.0](./v0.6.0.md) → … → [v0.6.15](./v0.6.15.md) → 现 **v0.6.16**（文稿；发包后 `@latest`）；回退钉 **0.3.11**。仓库 `docs/releases/v*` 仍可查阅。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途           | 命令                                                            |
| -------------- | --------------------------------------------------------------- |
| 当前（推荐）   | `npm i -g @xrkseek/harness-cli@latest`（= v0.6.16，发包后）后 `xrkh web` |
| 精确锁版本     | `npm i -g @xrkseek/harness-cli@0.6.16` 后 `xrkh web`            |
| 上一补丁       | `npm i -g @xrkseek/harness-cli@0.6.15` 后 `xrkh web`             |
| 本线收口号     | `npm i -g @xrkseek/harness-cli@0.6.0` 后 `xrkh web`             |
| 预览线过程号   | `npm i -g @xrkseek/harness-cli@rc`（= v0.6.0-rc.2，历史）后 `xrkh web` |
| 回退上一正式线 | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`             |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x` · `0.5.x`), **even = preview** (e.g. `0.2.x` · `0.4.x`). **Not** the PATCH digit.

**Current**: the `0.6.x` line is on **v0.6.16** (patch notes; owns npm `@latest` after publish). The previous patch [v0.6.15](./v0.6.15.md), the closing number [v0.6.0](./v0.6.0.md) and its process numbers [v0.6.0-rc.1](./v0.6.0-rc.1.md) / [v0.6.0-rc.2](./v0.6.0-rc.2.md) stay archived (npm `@rc` remains on rc.2). The prior formal line **v0.5.31** is now previous. The `0.4.x` preview line closed at **v0.4.12**.

| Slot | Version | Notes |
| ---- | ------- | ----- |
| **Current (@latest)** | [v0.6.16](./v0.6.16.md) | `0.6.x` patch: **OpenCode Zen/Go session header · true failure causes · lock reclaim · Desktop OOM** |
| **Previous patch** | [v0.6.15](./v0.6.15.md) | `0.6.x` patch: **archive confirm · timed countdown · catalog authority line · standing authority** |
| **Patch before that** | [v0.6.14](./v0.6.14.md) | `0.6.x` patch: **completion notify · Host mismatch reload · timed ask · archive gate · spill · compact sidebar** |
| **Line closing number** | [v0.6.0](./v0.6.0.md) | `0.6.x` close: **archive offload · Xiangyang/IM orchestration · Plugins reshape · standing disclosure · layered memory · per-workspace cwd jail · search shares the path gate** |
| **Process numbers (doc)** | [v0.6.0-rc.2](./v0.6.0-rc.2.md) · [rc.1](./v0.6.0-rc.1.md) | Preview hotfix and first rc; folded into this line |
| **Prior formal line** | [v0.5.31](./v0.5.31.md) | `0.5.x` formal: **vision tool results · image handle text · text-only routes stop hard-failing** |
| **Prior formal patch** | [v0.5.30](./v0.5.30.md) | `0.5.x` patch: **drag/drop source paths · read_file attachment ids · DSH stats parity** |
| **Prior preview close** | [v0.4.12](./v0.4.12.md) | `0.4.x` close: Mux drop-over-budget without kill · 5-miss heartbeat |
| **Rollback pin** | [v0.3.11](./v0.3.11.md) | `MINOR=3`; npm rollback pin (`@0.3.11`) |

Trail: preview close [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.31](./v0.5.31.md) → [v0.6.0](./v0.6.0.md) → … → [v0.6.15](./v0.6.15.md) → current **v0.6.16** (notes; `@latest` after publish); rollback pin **0.3.11**. Older `docs/releases/v*` stay readable.

Install and publish: [publishing.md](../publishing.md).

## npm install cheat sheet

| Use | Command |
| --- | ------- |
| Current (recommended) | `npm i -g @xrkseek/harness-cli@latest` (= v0.6.16 after publish) then `xrkh web` |
| Exact pin | `npm i -g @xrkseek/harness-cli@0.6.16` then `xrkh web` |
| Previous patch | `npm i -g @xrkseek/harness-cli@0.6.15` then `xrkh web` |
| Line closing number | `npm i -g @xrkseek/harness-cli@0.6.0` then `xrkh web` |
| Preview process number | `npm i -g @xrkseek/harness-cli@rc` (= v0.6.0-rc.2, historical) then `xrkh web` |
| Rollback prior formal line | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web` |

Spec index: [docs/README.md](../README.md).
