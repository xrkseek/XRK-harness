# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x` · `0.5.x`）、**偶数预览**（如 `0.2.x` · `0.4.x`）。**不是** PATCH（第三位）。

**本版**：`0.6.x` 线当前版本 **v0.6.23**（补丁文稿；接管 npm `@latest`）。**`0.6.x` 是预览线（MINOR 偶数），在 v0.6.23 收官，接续 `0.7.x` 正式线**；正式线过程号 [v0.7.0-rc.1](./v0.7.0-rc.1.md)（npm `@rc`，不接管 `@latest`）。上一补丁 [v0.6.22](./v0.6.22.md)、收口号 [v0.6.0](./v0.6.0.md) 与同线过程号 [v0.6.0-rc.1](./v0.6.0-rc.1.md) · [v0.6.0-rc.2](./v0.6.0-rc.2.md) 保留留档。上一正式线 **v0.5.31** 退为上一版。`0.4.x` 预览线已于 **v0.4.12** 收口。

| 档                  | 版本                                    | 说明                                                                 |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **当前（@latest）** | [v0.6.23](./v0.6.23.md)                 | `0.6.x` 补丁：**子代理并发 single-flight · 工作树租约自愈 / 重放合回** |
| **下一正式线过程号** | [v0.7.0-rc.1](./v0.7.0-rc.1.md)       | `0.7.x` 首 rc：**大会话读写 · 席位知识面 · Claude Code mods · Boss/干员壳**（`@rc`） |
| **本线收官（最后补丁）** | [v0.6.23](./v0.6.23.md)            | `0.6.x` 预览线在此收官，接续 `0.7.x` 正式线 |
| **上一补丁**        | [v0.6.22](./v0.6.22.md)                 | `0.6.x` 补丁：**过程折叠对齐 Cursor · 活动摘要 / 四档收起时机** |
| **上一补丁（前）**  | [v0.6.21](./v0.6.21.md)                 | `0.6.x` 补丁：**过程折叠收口 · 贴底即时折 / 停扫光 / 图片 peek** |
| **本线收口号**      | [v0.6.0](./v0.6.0.md)                   | `0.6.x` 收口：**归档减负 · 向阳/IM 编排 · 插件页重组 · 站立披露 · 分层记忆 · 多工作区 cwd 狱 · 搜索同路径闸** |
| **过程号（文稿）**  | [v0.6.0-rc.2](./v0.6.0-rc.2.md) · [rc.1](./v0.6.0-rc.1.md) | 预览热修与首 rc；已并入本线 |
| **上一正式线**      | [v0.5.31](./v0.5.31.md)                 | `0.5.x` 正式线：**视觉工具结果带图 · 句柄文本 · 纯文本模型不再硬失败** |
| **上一正式补丁**    | [v0.5.30](./v0.5.30.md)                 | `0.5.x` 补丁：**拖放文件带源路径 · read_file 支持附件 id · 统计口径对齐 DSH** |
| **上一预览终态**    | [v0.4.12](./v0.4.12.md)                 | `0.4.x` 收口：Mux 超顶丢帧不掐线 · 心跳 5 miss                          |
| **回退钉**          | [v0.3.11](./v0.3.11.md)                 | `MINOR=3`；npm 回退钉（`@0.3.11`）                                   |
| **收口号（文稿）**  | [v0.4.0](./v0.4.0.md)                   | 预览线收口；npm 已撤，见 GitHub Release                              |
| **过程号（文稿）**  | [rc.1](./v0.4.0-rc.1.md)…[rc.4](./v0.4.0-rc.4.md) | 已并入；npm 已撤                                           |
| **上一轮预览（文稿）** | [v0.2.7](./v0.2.7.md)                | npm 已撤；GitHub 对照留档                                            |

对照：预览终态 [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.31](./v0.5.31.md) → [v0.6.0](./v0.6.0.md) → … → [v0.6.22](./v0.6.22.md) → 现 **v0.6.23：0.6 预览线终点**（文稿；发包后 `@latest`），此后接 `0.7.x` 正式线；回退钉 **0.3.11**。仓库 `docs/releases/v*` 仍可查阅。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途           | 命令                                                            |
| -------------- | --------------------------------------------------------------- |
| 当前（推荐）   | `npm i -g @xrkseek/harness-cli@latest`（= v0.6.23，发包后）后 `xrkh web` |
| 精确锁版本     | `npm i -g @xrkseek/harness-cli@0.6.23` 后 `xrkh web`            |
| 上一补丁       | `npm i -g @xrkseek/harness-cli@0.6.22` 后 `xrkh web`             |
| 本线收口号     | `npm i -g @xrkseek/harness-cli@0.6.0` 后 `xrkh web`             |
| 下一正式线 rc  | `npm i -g @xrkseek/harness-cli@rc`（= v0.7.0-rc.1，发包后）后 `xrkh web` |
| 历史预览过程号 | `npm i -g @xrkseek/harness-cli@0.6.0-rc.2` 后 `xrkh web` |
| 回退上一正式线 | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`             |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x` · `0.5.x`), **even = preview** (e.g. `0.2.x` · `0.4.x`). **Not** the PATCH digit.

**Current**: the `0.6.x` line is on **v0.6.23** (patch notes; owns npm `@latest`). **`0.6.x` is a preview line (even MINOR) and ends at v0.6.23; the `0.7.x` formal line follows** via process number [v0.7.0-rc.1](./v0.7.0-rc.1.md) (npm `@rc`, does not take `@latest`). The previous patch [v0.6.22](./v0.6.22.md), the closing number [v0.6.0](./v0.6.0.md) and its process numbers [v0.6.0-rc.1](./v0.6.0-rc.1.md) / [v0.6.0-rc.2](./v0.6.0-rc.2.md) stay archived. The prior formal line **v0.5.31** is now previous. The `0.4.x` preview line closed at **v0.4.12**.

| Slot | Version | Notes |
| ---- | ------- | ----- |
| **Current (@latest)** | [v0.6.23](./v0.6.23.md) | `0.6.x` patch: **subagent single-flight · worktree lease heal / replay merge** |
| **Next formal process number** | [v0.7.0-rc.1](./v0.7.0-rc.1.md) | `0.7.x` first rc: **large-session I/O · seat knowledge · Claude Code mods · Boss/agent chrome** (`@rc`) |
| **Line close-out (last patch)** | [v0.6.23](./v0.6.23.md) | the `0.6.x` preview line ends here; the `0.7.x` formal line follows |
| **Previous patch** | [v0.6.22](./v0.6.22.md) | `0.6.x` patch: **process fold matches Cursor · activity line / four-point fold timing** |
| **Patch before that** | [v0.6.21](./v0.6.21.md) | `0.6.x` patch: **process-fold close-out · instant floor fold / stop shimmer / image peek** |
| **Line closing number** | [v0.6.0](./v0.6.0.md) | `0.6.x` close: **archive offload · Xiangyang/IM orchestration · Plugins reshape · standing disclosure · layered memory · per-workspace cwd jail · search shares the path gate** |
| **Process numbers (doc)** | [v0.6.0-rc.2](./v0.6.0-rc.2.md) · [rc.1](./v0.6.0-rc.1.md) | Preview hotfix and first rc; folded into this line |
| **Prior formal line** | [v0.5.31](./v0.5.31.md) | `0.5.x` formal: **vision tool results · image handle text · text-only routes stop hard-failing** |
| **Prior formal patch** | [v0.5.30](./v0.5.30.md) | `0.5.x` patch: **drag/drop source paths · read_file attachment ids · DSH stats parity** |
| **Prior preview close** | [v0.4.12](./v0.4.12.md) | `0.4.x` close: Mux drop-over-budget without kill · 5-miss heartbeat |
| **Rollback pin** | [v0.3.11](./v0.3.11.md) | `MINOR=3`; npm rollback pin (`@0.3.11`) |

Trail: preview close [v0.4.12](./v0.4.12.md) → [v0.5.0](./v0.5.0.md) → … → [v0.5.31](./v0.5.31.md) → [v0.6.0](./v0.6.0.md) → … → [v0.6.22](./v0.6.22.md) → current **v0.6.23: end of the 0.6 preview line** (notes; `@latest` after publish), with the `0.7.x` formal line to follow; rollback pin **0.3.11**. Older `docs/releases/v*` stay readable.

Install and publish: [publishing.md](../publishing.md).

## npm install cheat sheet

| Use | Command |
| --- | ------- |
| Current (recommended) | `npm i -g @xrkseek/harness-cli@latest` (= v0.6.23 after publish) then `xrkh web` |
| Exact pin | `npm i -g @xrkseek/harness-cli@0.6.23` then `xrkh web` |
| Previous patch | `npm i -g @xrkseek/harness-cli@0.6.22` then `xrkh web` |
| Line closing number | `npm i -g @xrkseek/harness-cli@0.6.0` then `xrkh web` |
| Next formal rc | `npm i -g @xrkseek/harness-cli@rc` (= v0.7.0-rc.1 after publish) then `xrkh web` |
| Historical preview process number | `npm i -g @xrkseek/harness-cli@0.6.0-rc.2` then `xrkh web` |
| Rollback prior formal line | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web` |

Spec index: [docs/README.md](../README.md).
