---
name: xrk-community-plugins
description: >-
  社区 client 包、xrk.host.json、host.mjs 与 dsh-compat 兼容器（A–J 层级）。
  装社区壳、写 host 半包或改 packages/server/http/dsh-compat 时使用。
disable-model-invocation: true
user-invocable: false
---

# 笔记 · 社区插件与 dsh-compat

教科书：[docs/community-plugins.md](../../../docs/community-plugins.md) · 实现笔记：[packages/server/http/src/dsh-compat/README.md](../../../packages/server/http/src/dsh-compat/README.md)。

## 架构（一句话）

社区 **`client.js`** 走 Face / 同源 HTTP → **能力表** + XRK 底层（`~/.xrk`）→ **bridge** → 未列路径诚实 JSON（非 SPA 404）。

内置兼容器：`extensions/dsh-compat`（`kind: host`）。

## 接入层级 A–J（装包前先归类）

| Tier | 触发 | Host |
|------|------|------|
| A | 仅 Face / 壳 API（含面板 `dynamicCordisRunner/*`） | 通常直接可用；不嵌 Cordis Host |
| B | 全局能力表 | XRK 持久化 |
| C | `*-settings` RPC | settings store |
| D | `/_dsh/<pkg>/…` | 通用 JSON |
| E–G | slug / catch-all / 未注册 POST | 诚实降级 |
| H | `xrk.host.json` | 作者声明 provider |
| I | `host.mjs`（含面板 `runHostHalf`） | 进程内 apply；失败 I′ 子进程 |
| J | 外部云端发行版 | 见 status「未做」 |

**不要**把「未实现」写成已支持；对照 [docs/status.md](../../../docs/status.md)。

## 与进程插件 / Desktop 安装面边界

| | 进程插件 | 社区 host/client | Desktop 插件安装面 |
|--|----------|------------------|-------------------|
| Manifest | `xrk.plugin.json` | 常含 `xrk.host.json` + `host.mjs` / client 包 | profile 依赖图（npm name/version） |
| 目的 | 模型工具 / prompt / 命令 | 壳 UI · Host RPC 形状兼容 | 桌面 profile 可执行闭包 |
| 安装 | `xrkh plugin add` | 同 CLI + 可能 **`web/boot.json` overlay** | 结构化 list/add/remove/update + 内置 pnpm（设计；未就绪） |
| 重载 | **`xrkh restart`** | 同左 | Desktop Host / 壳生命周期（实现时） |

**不要**把 Desktop 安装通道与社区 web overlay / dsh-compat 能力表混为一谈。教科书边界表：[docs/community-plugins.md](../../../docs/community-plugins.md)「Desktop 插件 vs 社区 client」。

## 权威入口

| 主题 | 路径 |
|------|------|
| 能力矩阵真源 | `dsh-compat-matrix.ts` |
| 回归 fixture | `packages/server/http/tests/fixtures/compat-host-suite.json` |
| 金样 host 插件 | `extensions/dsh-compat/` |

## 执行步骤（改兼容器）

1. 读 community-plugins + dsh-compat README。  
2. 新 RPC：优先扩 capability table / bridge，**不要** embed Cordis Host（ADR-0002）。  
3. 补 http 测或 fixture 条目。  
4. 同步 `docs/community-plugins.md` · `status.md`（已实现 vs 待补）。

## 常见陷阱

- 按**包名**堆适配器 — Harness 按**路径与 RPC 形状**接线。  
- 对上游第三方仓提 PR — **禁止**（产品身份规则；ADR-0002）。  
- 把 maintainer `.cursor` 笔记当社区包规格。

## 相关

- **`xrk-plugin-dev`** — 进程插件主线  
- **`xrk-docs-audience`** — 写 community-plugins 文档时
