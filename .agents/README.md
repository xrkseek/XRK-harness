# `.agents/` — 本仓作工作区时的产品层

> 对标 XRK-AGT `agents/workspace/`。**设本仓为工作区**时 Host 读这里（并跳过根维护者 `AGENTS.md`）。

| 路径 | 作用 |
|------|------|
| `AGENTS.md` | **本仓写插件**角色（不是全局桌面工作区默认） |
| `IDENTITY.md` · `SOUL.md` · `TOOLS.md` | 薄人格 |
| `context/` | 常驻边界 |
| `skills/` · `recipes/` | 工作区覆盖；**可改，但产品默认真源是 CLI seeds** |

## 中心在哪

| 层 | 路径 | 何时生效 |
|----|------|----------|
| **全局产品默认** | `apps/cli/seeds/` → `~/.xrk/`（`xrkh web`/`serve`） | 任意工作区（含桌面） |
| **本仓工作区** | 本目录 `.agents/` | 仅工作区 = 本 monorepo |
| **维护者笔记** | `.cursor/` · 根 `AGENTS.md` | Cursor 改内核；不进产品 inject |

跨工作区 skill / 薄 `AGENTS.md` / recipes：**先改 `apps/cli/seeds/`**，再按需薄同步本目录作对照。
