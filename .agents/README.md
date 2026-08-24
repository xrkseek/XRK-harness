# `.agents/` — 产品工作区（自动发现）

> 对标 XRK-AGT 的 `agents/skills/` + `agents/workspace/`。**无需 sync** — 设本仓为工作区即生效。

| 路径 | 作用 |
|------|------|
| `AGENTS.md` | 产品角色（Host 注入；替代根维护者 AGENTS） |
| `context/` | 常驻边界（inject） |
| `skills/` | 产品 skill catalog（`.agents/skills` 自动扫） |
| `recipes/` | 斜杠配方（preset 自动加载） |

维护者笔记仍在 `.cursor/`（不进 Host 产品 inject）。
