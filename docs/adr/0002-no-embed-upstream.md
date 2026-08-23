# ADR-0002: 内核边界

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-08-23
- **Tags:** boundaries, licensing, dsh-compat

## Context

session / loop / tools / host 是本仓产品内核。聊天 UI 吃人力；完全平行自研会丢掉 DSH 社区插件生态。

DSH Web 与大量社区插件均为 **MIT**。在 XRK 上跑这些插件是明确产品目标：**该抄的抄、该拿来的拿、该自研的自研、该 bridge 的搭 bridge**——按能力切片选实现，而不是用一条「一律不嵌」挡住满血兼容。

仍须与上游 **GitHub Fork / 跟踪 deepseek-ai / 给 deepseek-ai 提 PR** 划清界限：XRK 是独立产品面，不是别人的贡献分支。

## Decision

### 内核（不变）

本仓实现：**session 事件真源**、agent loop / 工具瀑布、compose / presets、进程插件 kind、Face wire。

### Host / 外壳（修订）

对 DSH Web 与社区插件做 **MIT 二次创作与兼容**，标准路径：

| 层 | 职责 |
| --- | --- |
| **XRK Port** | session、cost-meter、settings/credentials、持久化等真能力 |
| **Bridge** | DSH HTTP/RPC 外形 ↔ XRK Port 字段映射（如 wallet、cost-meter balance） |
| **HTTP adapter** | 路径/方法解析，零业务 |
| **Cordis / `kind:cordis`** | 优先 `host.mjs` + dsh-compat apply；**允许**子进程宿主、拷贝 MIT Cordis 运行时、或等价 fiber 实现——以插件能跑为准，inventory 不再一律标 `failed` 当终态 |

外壳落点：

- 标准路径与 DSH 对齐：`apps/web` + `packages/client/*`（源码；serve 用 `apps/web/dist`）
- 品牌：`apps/web/public`（XRK logo / PWA）
- Face 验证台：`apps/console`（`?console=1`；维护者工具，非产品入口）
- 无 vendor、无捕获目录；对照实现看本机 bar 仓（路径不进 docs）
- 无 DSH upstream remote、**不对 deepseek-ai 提 PR**
- 本仓根 [LICENSE](../../LICENSE)；DeepSeek 署名见 [apps/web/NOTICE](../../apps/web/NOTICE)

### 明确允许（示例）

- 从 MIT `dsh-*` **移植** host 逻辑（如 DeepSeek `GET /user/balance`、ledger 形状）
- Face `costMeter/*`、wallet、settings 等与 DSH 插件契约对齐
- `kind:host` 插件 HTTP _claim + dsh-compat 能力表
- Cordis fiber / IM 隧道：**实现或 bridge**，诚实标 `incomplete` 仅用于尚未接线的切片，不作为永久借口

## Consequences

- 规格以本仓 `docs/` + 代码为准；`docs/status.md` 按切片更新「能跑 / 未稳 / 未做」
- Face 说 DSH 形 wire，真源仍是 session 事件
- 产品 boot 可省略 Cordis 客户端面板与捕获壳 HMR（UX 选择，非兼容禁令）
- `apps/web` + `packages/client` 已进 pnpm workspace；插件 `client.js` 由本仓 `pnpm client:bundle` 编出
- 维护者笔记（`AGENTS.md`）中「不嵌 Cordis Host」表述以本 ADR 修订为准
