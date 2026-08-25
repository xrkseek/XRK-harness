# ADR-0002: 内核与外壳边界

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-08-25
- **Tags:** boundaries, licensing, host-adapter

## 背景

本仓产品内核覆盖 session / loop / tools / Host Face。产品壳需要可加载社区 MIT 客户端与插件，同时保持内核契约清晰、可维护。

实现策略按能力切片：**移植、自研、或经适配层 bridge**——以「插件能跑、契约诚实」为准。

## 决策

### 内核

本仓实现并拥有：

- session 事件为对话真源  
- agent loop / 工具瀑布  
- compose / presets  
- 进程插件 kind  
- Face wire  

### Host / 外壳

社区 Web 与插件走 MIT 兼容路径：

| 层 | 职责 |
| --- | --- |
| **XRK Port** | session、cost-meter、settings/credentials、持久化等真能力 |
| **Bridge** | 社区 HTTP/RPC 外形 ↔ XRK Port 字段映射 |
| **HTTP adapter** | 路径/方法解析，零业务 |
| **Cordis / `kind:cordis`** | 优先 `host.mjs` + Host 适配层 apply；允许子进程或等价 fiber，以插件能跑为准 |

外壳落点：

- 产品壳：`apps/web` + `packages/client/*`（serve 用 `apps/web/dist`）  
- 品牌资源：`apps/web/public`  
- Face 验证台：`apps/console`（`?console=1`；维护者工具，非产品入口）  
- 不在仓内 vendor 捕获第三方树；本机对照路径不进 docs  
- 本仓根 [LICENSE](../../LICENSE)；第三方署名见 [apps/web/NOTICE](../../apps/web/NOTICE)  
- 独立产品仓库与独立发布线（npm `@xrkseek/*`）  

### 明确允许（示例）

- 从 MIT 社区包移植 host 逻辑（如 balance、ledger 形状）  
- Face `costMeter/*`、wallet、settings 等与社区插件契约对齐  
- `kind:host` 插件 HTTP claim + 适配层能力表  
- Cordis fiber / IM 隧道：实现或 bridge；`incomplete` 仅用于尚未接线的切片  

## 后果

- 规格以本仓 `docs/` + 代码为准；`docs/status.md` 按切片更新「能跑 / 未稳 / 未做」  
- Face 可暴露社区形 wire，真源仍是 session 事件  
- 产品 boot 可省略部分客户端面板与 HMR（UX 选择）  
- `apps/web` + `packages/client` 已进 pnpm workspace；插件 `client.js` 由 `pnpm client:bundle` 编出  

---

# ADR-0002: Kernel and shell boundary

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-08-25
- **Tags:** boundaries, licensing, host-adapter

## Context

This repository’s product kernel covers session / loop / tools / Host Face. The product shell must load community MIT clients and plugins while keeping kernel contracts clear and maintainable.

Implementation chooses by capability slice: **port, implement first-party, or bridge** — judged by “plugins run” and honest contracts.

## Decision

### Kernel

This repository owns:

- Session events as dialogue source of truth  
- Agent loop / tool waterfall  
- Compose / presets  
- Process-plugin kinds  
- Face wire  

### Host / shell

Community Web and plugins follow an MIT compatibility path:

| Layer | Responsibility |
| --- | --- |
| **XRK Port** | Real capabilities (session, cost-meter, settings/credentials, persistence) |
| **Bridge** | Community HTTP/RPC shape ↔ XRK Port fields |
| **HTTP adapter** | Path/method parse; zero business logic |
| **Cordis / `kind:cordis`** | Prefer `host.mjs` + Host-adapter apply; subprocess or equivalent fiber allowed so plugins can run |

Shell placement:

- Product shell: `apps/web` + `packages/client/*` (`serve` uses `apps/web/dist`)  
- Brand assets: `apps/web/public`  
- Face console: `apps/console` (`?console=1`; maintainer tool, not the product entry)  
- No vendored capture trees in-repo; local comparison paths stay out of docs  
- Root [LICENSE](../../LICENSE); third-party attribution in [apps/web/NOTICE](../../apps/web/NOTICE)  
- Independent product repository and release line (npm `@xrkseek/*`)  

### Explicitly allowed (examples)

- Port host logic from MIT community packages (e.g. balance / ledger shapes)  
- Align Face `costMeter/*`, wallet, settings with community plugin contracts  
- `kind:host` HTTP claims + adapter capability table  
- Cordis fiber / IM tunnels: implement or bridge; `incomplete` only for unwired slices  

## Consequences

- Specs follow this repo’s `docs/` + code; `docs/status.md` tracks Working / Unstable / Not done per slice  
- Face may expose community-shaped wire; session events remain the source of truth  
- Product boot may omit some client panels and HMR (UX choice)  
- `apps/web` + `packages/client` are in the pnpm workspace; plugin `client.js` is built with `pnpm client:bundle`  
