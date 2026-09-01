---
name: xrk-adapt-workspace
description: >-
  空仓/陌生工作区快速适应：探测栈、落可选站立文件、挂能力。
  用户说「空项目」「新工作区」「适应这个仓库」「这是什么项目」时使用。
---

# 工作区适应

## 步骤

1. **只读探测** — 有无 `package.json` / `pnpm-lock` / `Cargo.toml` / `go.mod` / `pyproject` / `README`；不要一上来建 `.xrk`  
2. **站立说明（可选）** — 仅当用户同意时写 `{workspace}/.agents/AGENTS.md` 或 `.xrk/AGENTS.md`（薄角色表）；**默认不创建** `.xrk/`  
3. **能力** — 外部工具 → skill **`xrk-capability-attach`**（Settings MCP）；本仓 JS → 进程插件（须 restart）  
4. **自我升级** — 可复用流程 → **`xrk-create-skill`** 写到 `~/.xrk/skills` 或工作区 skills  

## 红线

- 不为「方便」在陌生仓自动 mkdir `.xrk`（对标 Cursor/Trae：无则跳过）  
- 密钥走 Credentials；不写入 skill 正文  
