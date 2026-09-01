# `.agents/` — 产品工作区（自动发现）

> 对标 XRK-AGT 的 `agents/skills/` + `agents/workspace/`。**无需 sync** — 设本仓为工作区即生效。

| 路径 | 作用 |
|------|------|
| `AGENTS.md` | 产品角色（Host 注入；替代根维护者 AGENTS） |
| `IDENTITY.md` · `SOUL.md` · `TOOLS.md` | 薄人格与能力挂载习惯 |
| `context/` | 常驻边界（inject） |
| `skills/` | 工作区产品 skill（可覆盖 `~/.xrk/skills`） |
| `recipes/` | 斜杠配方（`/mcp-attach` · `/plugin-scaffold`） |

跨工作区默认 skill 真源在 GitHub：`apps/cli/seeds/skills/` → 安装到用户目录 **`~/.xrk/skills/`**（`xrkh doctor` / `serve`）。

维护者笔记仍在 `.cursor/`（不进 Host 产品 inject）。
