---
name: xrk-mcp-plugins
description: >-
  Harness 上 MCP 与进程插件选型：@xrkseek/mcp、policy 默认 deny、热挂载 vs tools 插件。
  用户要接 MCP、写 mcp__ 工具或改 packages/mcp 时使用。
disable-model-invocation: true
user-invocable: false
---

# 笔记 · MCP vs 进程插件

教科书：[docs/modules/mcp.md](../../../docs/modules/mcp.md) · [docs/policy.md](../../../docs/policy.md) · [docs/plugin-development.md](../../../docs/plugin-development.md)（选型表）。

## 选型（先答这个）

| 用户需求 | 用 | 不用 |
|----------|-----|------|
| 给模型几个**固定 JS 函数**、无外部进程 | **`kind: tools`** 进程插件 | 为简单函数单独起 MCP |
| 接 **stdio/SSE MCP 服务器**（已有或第三方） | **`@xrkseek/mcp`** + Host `XRK_MCP_*` / 文件真源 | 手写 subprocess 进 tools 插件 |
| 追加 **system 段落** | **`kind: prompt`** 或 workspace inject | MCP |
| 斜杠命令 | **`kind: commands`** 或 `.xrk/recipes` | MCP |

MCP 工具在 registry 上通常为 **`mcp__<server>__<tool>`** 命名；policy **默认 deny**，需显式放行。

## 权威入口

| 主题 | 路径 |
|------|------|
| MCP 模块 | `packages/mcp/` · [docs/modules/mcp.md](../../../docs/modules/mcp.md) |
| Policy | `packages/policy/` · [docs/policy.md](../../../docs/policy.md) |
| Host 挂载 | Face settings · env `XRK_MCP_*` |
| 进程插件 | **`xrk-extensions`** |

## 执行步骤（集成 MCP）

1. 读 [status.md](../../../docs/status.md) MCP 行是否可依赖。
2. 配置 server 列表（settings / env）；**密钥不入库**。
3. 在 policy 或 Host 默认策略中放行所需 `mcp__*` 前缀。
4. 会话徽章 **harness**（完整工具面）；验证工具出现在 inventory。
5. 改契约 → 同步 `docs/modules/mcp.md` · `status.md`。

## 与 XRK-AGT 差异

AGT 工作区 Core 用 `getMcpServers()` / `registerMCPTool` on AiWorkflow。  
Harness **没有** PluginBase；远程 MCP 走 **`@xrkseek/mcp`**，本地逻辑走 **tools 插件**。

## 常见陷阱

- 把 MCP 服务器当 Cordis 插件 apply — 不对；MCP 是独立挂载线。  
- 未配 policy 却期望模型能调 MCP — 默认 **deny**。  
- 在 tools 插件里长期 spawn MCP 子进程 — 应交给 MCP 模块统一生命周期。

## 相关

- **`xrk-plugin-dev`** · **`xrk-extensions`**  
- 产品选型：种子 **`xrk-plugin-kind`**
