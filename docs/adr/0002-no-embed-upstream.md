# ADR-0002: 内核边界 / Kernel Boundary

> **读者 / Audience**：维护者 · 贡献者 / Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-08-23
- **Tags:** boundaries, licensing, dsh-compat

## 背景 / Context

session / loop / tools / host 是本仓产品内核。聊天 UI 吃人力；完全平行自研会丢掉社区插件生态。

session / loop / tools / host form this product’s kernel. A fully parallel UI rewrite would forfeit the community plugin ecosystem.

大量社区 Web 与插件均为 **MIT**。在 XRK 上跑这些插件是明确产品目标：**该抄的抄、该拿来的拿、该自研的自研、该 bridge 的搭 bridge**——按能力切片选实现，而不是用一条「一律不嵌」挡住满血兼容。

Many community Web surfaces and plugins are **MIT**. Running them on XRK is an explicit product goal: **copy, adopt, implement first-party, or bridge by capability slice** — not a blanket “never embed” rule that blocks full compatibility.

仍须与上游 **GitHub Fork / 跟踪 deepseek-ai / 给 deepseek-ai 提 PR** 划清界限：XRK 是独立产品面，不是别人的贡献分支。

XRK remains a separate product surface: not a GitHub Fork of deepseek-ai, not a contribution branch, and not a venue for PRs to deepseek-ai.

## 决策 / Decision

### 内核（不变） / Kernel (unchanged)

本仓实现：**session 事件真源**、agent loop / 工具瀑布、compose / presets、进程插件 kind、Face wire。

This repository owns: **session events as source of truth**, agent loop / tool waterfall, compose / presets, process-plugin kinds, and Face wire.

### Host / 外壳（修订） / Host / shell (revised)

对社区 Web 与插件做 **MIT 二次创作与兼容**，标准路径：

For community Web and plugins, perform **MIT second creation and compatibility** along this path:

| 层 / Layer | 职责 / Responsibility |
| --- | --- |
| **XRK Port** | session、cost-meter、settings/credentials、持久化等真能力 / Real capabilities |
| **Bridge** | 社区 HTTP/RPC 外形 ↔ XRK Port 字段映射 / Shape mapping to XRK ports |
| **HTTP adapter** | 路径/方法解析，零业务 / Path/method parse; zero business logic |
| **Cordis / `kind:cordis`** | 优先 `host.mjs` + dsh-compat apply；允许子进程宿主或等价 fiber——以插件能跑为准 / Prefer `host.mjs` + dsh-compat apply; subprocess or equivalent fiber allowed so plugins can run |

外壳落点 / Shell placement：

- 标准路径：`apps/web` + `packages/client/*`（源码；serve 用 `apps/web/dist`）
- 品牌：`apps/web/public`（XRK logo / PWA）
- Face 验证台：`apps/console`（`?console=1`；维护者工具，非产品入口）
- 无 vendor、无捕获目录；本机对照路径不进 docs
- 无 deepseek-ai upstream remote、**不对 deepseek-ai 提 PR**
- 本仓根 [LICENSE](../../LICENSE)；第三方署名见 [apps/web/NOTICE](../../apps/web/NOTICE)

### 明确允许（示例） / Explicitly allowed (examples)

- 从 MIT 社区包 **移植** host 逻辑（如 balance、ledger 形状）
- Face `costMeter/*`、wallet、settings 等与社区插件契约对齐
- `kind:host` 插件 HTTP claim + dsh-compat 能力表
- Cordis fiber / IM 隧道：**实现或 bridge**；`incomplete` 仅用于尚未接线的切片

## 后果 / Consequences

- 规格以本仓 `docs/` + 代码为准；`docs/status.md` 按切片更新「能跑 / 未稳 / 未做」
- Face 可说社区形 wire，真源仍是 session 事件
- 产品 boot 可省略部分客户端面板与捕获壳 HMR（UX 选择，非兼容禁令）
- `apps/web` + `packages/client` 已进 pnpm workspace；插件 `client.js` 由本仓 `pnpm client:bundle` 编出
- 维护者笔记（`AGENTS.md`）中「不嵌 Cordis Host」表述以本 ADR 为准
