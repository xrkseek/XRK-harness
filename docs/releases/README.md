# 发行说明

> **读者**：终端用户 · 维护者

版本约定：`MAJOR.MINOR.PATCH` 里 **MINOR（第二位）奇偶**——**奇数正式**（如 `0.3.x`）、**偶数预览**（如 `0.2.x`）。**不是** PATCH（第三位）；正式线上补丁按 `0.3.7` → `0.3.8` → `0.3.9` 顺序递增。

GitHub Release 公开页保留两档（正式当前 + 预览末号）：

| 档 | 版本 | 说明 |
|------|------|------|
| **正式 · 当前（@latest）** | [v0.3.9](./v0.3.9.md) | `MINOR=3` 正式线；推荐 `npm i -g @xrkseek/harness-cli@latest` |
| **预览 · 末号** | [v0.2.7](./v0.2.7.md) | `MINOR=2` 预览线结束；对照留档，不推荐日常安装 |

对照：昔日正式 [v0.1.31](./v0.1.31.md) → [v0.3.8](./v0.3.8.md) → 现 **v0.3.9**；昔日预览 **0.0.11**（已撤）→ 现末号 **v0.2.7**。仓库内其余 `docs/releases/v*` 仍可查阅；npm 旧号以 deprecate 为准。

安装与发包见 [publishing.md](../publishing.md)。

## npm 安装速查

| 用途 | 命令 |
|------|------|
| 正式（推荐） | `npm i -g @xrkseek/harness-cli@0.3.9` 后 `xrkh web`，或 `@latest` |
| 预览末号（对照） | `npm i -g @xrkseek/harness-cli@0.2.7` 后 `xrkh web` |

规格索引：[docs/README.md](../README.md)。

---

# Release Notes

> **Audience**: End users · Maintainers

Version rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (e.g. `0.3.x`), **even = preview** (e.g. `0.2.x`). **Not** the PATCH digit; on a formal line, patches increment sequentially (`0.3.7` → `0.3.8` → `0.3.9`).

The GitHub Releases page keeps two entries (current formal + last preview):

| Line | Version | Notes |
|------|---------|-------|
| **Formal · current (@latest)** | [v0.3.9](./v0.3.9.md) | `MINOR=3` formal line; prefer `npm i -g @xrkseek/harness-cli@latest` |
| **Preview · last** | [v0.2.7](./v0.2.7.md) | `MINOR=2` preview line ended; archive only — not for daily install |

Succession: formal [v0.1.31](./v0.1.31.md) → [v0.3.8](./v0.3.8.md) → **v0.3.9**; preview **0.0.11** (withdrawn) → last **v0.2.7**. Other `docs/releases/v*` remain for reference; npm older numbers follow deprecate notices.

Install and publish: [publishing.md](../publishing.md).

## npm install cheat sheet

| Use | Command |
|-----|---------|
| Formal (recommended) | `npm i -g @xrkseek/harness-cli@0.3.9` then `xrkh web`, or `@latest` |
| Last preview (reference) | `npm i -g @xrkseek/harness-cli@0.2.7` then `xrkh web` |

Spec index: [docs/README.md](../README.md).
