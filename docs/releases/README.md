# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x`）、**偶数预览**（如 `0.2.x`）。**不是** PATCH（第三位）；正式线上补丁按 `0.3.9` → `0.3.10` → `0.3.11` 顺序递增。

GitHub Release 公开页保留正式当前 + 预览当前：

| 档 | 版本 | 说明 |
|------|------|------|
| **正式 · 当前（@latest）** | [v0.3.11](./v0.3.11.md) | `MINOR=3` 正式线；推荐 `npm i -g @xrkseek/harness-cli@latest` |
| **预览 · 当前** | [v0.4.0-rc.2](./v0.4.0-rc.2.md) | `MINOR=4` 预览线；npm dist-tag `rc`，**不覆盖** `@latest` |
| **预览 · 上一轮末号** | [v0.2.7](./v0.2.7.md) | `MINOR=2` 预览线结束；对照留档，不推荐日常安装 |

对照：昔日正式 [v0.1.31](./v0.1.31.md) → [v0.3.10](./v0.3.10.md) → 现 **v0.3.11**；预览线 **0.0.11**（已撤）→ 上一轮末号 **v0.2.7** → 现 **v0.4.0-rc.2**。仓库内其余 `docs/releases/v*` 仍可查阅；npm 旧号以 deprecate 为准。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途 | 命令 |
|------|------|
| 正式（推荐） | `npm i -g @xrkseek/harness-cli@0.3.11` 后 `xrkh web`，或 `@latest` |
| 预览（本版） | `npm i -g @xrkseek/harness-cli@0.4.0-rc.2` 后 `xrkh web`，或 `@rc` |
| 上一轮预览末号（对照） | `npm i -g @xrkseek/harness-cli@0.2.7` 后 `xrkh web` |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x`), **even = preview** (e.g. `0.2.x`). **Not** the PATCH digit; on a formal line, patches increment sequentially (`0.3.9` → `0.3.10` → `0.3.11`).

The GitHub Releases page keeps current formal + current preview:

| Line | Version | Notes |
|------|---------|-------|
| **Formal · current (@latest)** | [v0.3.11](./v0.3.11.md) | `MINOR=3` formal line; prefer `npm i -g @xrkseek/harness-cli@latest` |
| **Preview · current** | [v0.4.0-rc.2](./v0.4.0-rc.2.md) | `MINOR=4` preview line; npm dist-tag `rc`, does **not** move `@latest` |
| **Preview · previous line end** | [v0.2.7](./v0.2.7.md) | `MINOR=2` preview line ended; archive only — not for daily install |

Succession: formal [v0.1.31](./v0.1.31.md) → [v0.3.10](./v0.3.10.md) → **v0.3.11**; preview **0.0.11** (withdrawn) → **v0.2.7** → **v0.4.0-rc.2** (new `MINOR=4` line). Other `docs/releases/v*` remain for reference; npm older numbers follow deprecate notices.

Install and publish: [publishing.md](../publishing.md).

## npm install cheat sheet

| Use | Command |
|-----|---------|
| Formal (recommended) | `npm i -g @xrkseek/harness-cli@0.3.11` then `xrkh web`, or `@latest` |
| Preview (this release) | `npm i -g @xrkseek/harness-cli@0.4.0-rc.2` then `xrkh web`, or `@rc` |
| Previous preview line end | `npm i -g @xrkseek/harness-cli@0.2.7` then `xrkh web` |

Spec index: [docs/README.md](../README.md).
