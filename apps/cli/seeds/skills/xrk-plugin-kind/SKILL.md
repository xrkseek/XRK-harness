---
name: xrk-plugin-kind
description: >-
  Choose the right XRK extension shape: MCP Settings first, then process
  plugins (tools/prompt/commands) or client UI overlay. Use when the user asks
  「用哪种插件」「要不要 MCP」「改 UI 还是加工具」「plugins vs MCP」.
---

# 扩展形态选型

**默认**：给模型新外部能力 → **设置 → 插件 → MCP**（skill **`xrk-capability-attach`**）。  
进程插件只在「必须落在本机目录、不值得起 MCP」时用。

```
- [ ] 1. 用户要的是外部服务 / 已有 MCP 包？→ MCP
- [ ] 2. 只要改壳 UI？→ client 叠加（不是 tools）
- [ ] 3. 要仓库内自有 JS 工具 / prompt / 斜杠？→ 进程插件 kind
- [ ] 4. 选定后跳到对应 skill，别混写
```

| 用户要什么 | 选 | 下一步 |
|------------|-----|--------|
| 接已有 / 可起的 MCP 服务器 | **MCP Settings** | **`xrk-capability-attach`** |
| 本机简单自有函数给模型调 | **`kind: tools`** | **`xrk-plugin-author`** |
| 追加 system 段 | **`kind: prompt`** | **`xrk-plugin-author`** |
| 斜杠命令 | **`kind: commands`** 或用户 recipes | author / 用户自建 recipe |
| 改壳 UI | **client 叠加** | 社区 / client 插件文档，不是 tools |

## 决策启发式

- 已经是 MCP 包 → **挂 MCP**，不要再包一层 tools 插件  
- 单函数、要进当前仓库目录、不想起 MCP 进程 → tools 插件  
- 「装好了吗 / 工具看不到」→ **`xrk-plugin-verify`**（进程插件须 restart；MCP 看 Settings 行）

## 反模式

- 一律脚手架进程插件，从不考虑 MCP  
- 用 tools 插件改 UI  
- 未 restart 就断言「插件坏了」
