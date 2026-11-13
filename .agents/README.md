# `.agents/` — 本仓作工作区时的产品层

> 对标 XRK-AGT `agents/workspace/`。**设本仓为工作区**时 Host 读这里（并跳过根维护者 `AGENTS.md`），**叠在** `~/.xrk/` 种子之上，而不是再抄一份种子。

| 路径 | 作用 |
|------|------|
| `AGENTS.md` | **本仓写插件**增量（角色、落点、CodeGraph）；全局站立不在此 |
| `IDENTITY.md` · `SOUL.md` · `TOOLS.md` | 薄人格（插件教练） |
| `context/` | 常驻边界笔记（Face / 子代理 / 手机 OFM 等） |
| `skills/` | **仅本仓增量**（架构 / CodeGraph / 发版链 / 本机陷阱） |
| `recipes/` | **仅本仓斜杠**（如 `/plugin-scaffold`） |

## 中心在哪

| 层 | 路径 | 何时生效 |
|----|------|----------|
| **全局产品默认** | `apps/cli/seeds/` → `~/.xrk/`（`xrkh web`/`serve`） | 任意工作区（含桌面） |
| **本仓工作区** | 本目录 `.agents/` | 仅工作区 = 本 monorepo；**禁止**与 seeds 同名复写 |
| **维护者笔记** | `.cursor/` · 根 `AGENTS.md` | Cursor 改内核；不进产品 inject |

跨工作区 skill / 站立 `AGENTS.md` / 通用 recipes：**只改 `apps/cli/seeds/`**。本目录不要「薄同步对照」。

## Agent 怎么找路

| 你是谁 | 先打开 |
|--------|--------|
| 产品 Agent（徽章 harness，写 `extensions/`） | 本目录 `AGENTS.md` → skill **`xrk-harness-monorepo`** |
| Cursor 改内核 / 发版 / 打 APK | 根 `AGENTS.md` → `.cursor/skills/SKILL_INDEX.md` → **`xrk-harness-knowledge-map`** |
| 只问「知识在哪」 | **`xrk-harness-knowledge-map`**（索引，不抄正文） |

`context/` **不放**发版日记、产品化长草稿；那种内容进 skill 踩坑表或教科书 `docs/`，写完删临时稿。
