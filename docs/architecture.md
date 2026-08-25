# 架构

> **读者**：集成者 · 贡献者 · 维护者

宿主 **仅 TypeScript（Node ≥26）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

## 决策（ADR）

| ADR | 决策 |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 仅 TypeScript 宿主 |
| [0002](./adr/0002-no-embed-upstream.md) | 内核本仓实现；产品壳在 `apps/web` + `packages/client`（MIT 二次创作） |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 |
| [0004](./adr/0004-no-effect-runtime.md) | 无代数效应运行时内核 |
| [0005](./adr/0005-compose-leaf.md) | 组合叶包 `@xrkseek/compose` |

文档读者与写作标准见 [audiences.md](./audiences.md)。能力矩阵：[status.md](./status.md)。

## 包平面

```text
┌─────────────────────────────────────────────────────────┐
│  apps/cli · apps/web（产品壳）· apps/console（验证台）   │
│  packages/client（壳客户端包）                           │
├─────────────────────────────────────────────────────────┤
│  presets: minimal | harness | server   ← 只组合，无业务  │
│  @xrkseek/harness (sdk)                                  │
├─────────────────────────────────────────────────────────┤
│  server-host / http / face / config / loader             │
├──────────────┬──────────────────┬───────────────────────┤
│ core-agent   │ core-agent-loop  │ core-tools            │
│ core-session │ system-prompt    │ workspace · policy    │
├──────────────┴──────────────────┴───────────────────────┤
│  llm · exec-* · code-runtime · compose · mcp · attachment │
├─────────────────────────────────────────────────────────┤
│  kernel · protocol                                       │
└─────────────────────────────────────────────────────────┘
```

## 仓库树（与落盘对齐）

33 个 `@xrkseek/*` 库包。改路径先改本树与 [status.md](./status.md)，再改代码。

```text
XRK-harness/
├── apps/
│   ├── cli/                 # @xrkseek/harness-cli
│   ├── web/                 # 产品壳源码；serve 用 dist/
│   └── console/             # Face 验证台（?console=1；维护者工具，非产品入口）
├── packages/
│   ├── client/              # 壳客户端包（与 apps/web 成对）
│   ├── kernel/ · protocol/ · compose/
│   ├── session/session-projection/  # 投影状态/视图缝
│   ├── core/{agent,agent-loop,tools,session,system-prompt}/
│   ├── llm/{llm,openai-compatible,deepseek,replay,registry}/
│   ├── mcp/ · attachment/
│   ├── exec/{fs,subprocess,shell,sandbox,web,lsp,pty}/
│   ├── workspace/ · policy/ · code-runtime/ · web-runtime/
│   ├── server/{http,loader,host,config,face}/
│   ├── sdk/ · testkit/
│   └── …
├── presets/{minimal,harness,server}/
├── extensions/              # 进程插件样例（tools / channels）
├── .agents/                 # 工作区 Agent 层（inject + skills）
├── docs/                    # 规格真源
└── scripts/
```

会话持久化（Host `XRK_SESSIONS_DIR`）：`sessions.db`（WAL · schema v3 · 物理 `text-chunks` · FTS5 trigram）+ 旁路 `subagents.json` · `goals.json`。ZIP 导出 `toPackedJSONL` + `.jsonl.zst`。

Host agent-cache：根会话 Scope `agent:{id}`；Face 已登记父会话的子会话走 `openSubagentRealm`（`subagent:{id}`）。

Face 接线：`packages/server/face/src/wire/`。投影驱动：`@xrkseek/session-projection`（Face `projections/` 载体）。产品壳源码 `apps/web` + `packages/client`；serve 托管 `apps/web/dist`（先 `web:build` + `client:bundle` + `web:assemble`）。`apps/console` 仅作 Face 验证台。

---

# Architecture

> **Audience**: Integrators · Contributors · Maintainers

The host is **TypeScript-only (Node ≥26)**. The session source of truth is append-only **session events**; agent loop / turn state is short-lived.

## Decisions (ADR)

| ADR | Decision |
|-----|----------|
| [0001](./adr/0001-typescript-only-host.md) | TypeScript-only host |
| [0002](./adr/0002-no-embed-upstream.md) | In-repo kernel; product shell in `apps/web` + `packages/client` (MIT remix) |
| [0003](./adr/0003-session-long-loop-short.md) | Session long-lived · Loop short-lived |
| [0004](./adr/0004-no-effect-runtime.md) | No algebraic-effect runtime kernel |
| [0005](./adr/0005-compose-leaf.md) | Composition leaf `@xrkseek/compose` |

Documentation audiences and writing standards: [audiences.md](./audiences.md). Capability matrix: [status.md](./status.md).

## Package planes

```text
┌─────────────────────────────────────────────────────────┐
│  apps/cli · apps/web (shell) · apps/console (console)   │
│  packages/client (shell client packages)                 │
├─────────────────────────────────────────────────────────┤
│  presets: minimal | harness | server   ← compose only   │
│  @xrkseek/harness (sdk)                                  │
├─────────────────────────────────────────────────────────┤
│  server-host / http / face / config / loader             │
├──────────────┬──────────────────┬───────────────────────┤
│ core-agent   │ core-agent-loop  │ core-tools            │
│ core-session │ system-prompt    │ workspace · policy    │
├──────────────┴──────────────────┴───────────────────────┤
│  llm · exec-* · code-runtime · compose · mcp · attachment │
├─────────────────────────────────────────────────────────┤
│  kernel · protocol                                       │
└─────────────────────────────────────────────────────────┘
```

## Repository tree (on-disk layout)

Thirty-three `@xrkseek/*` library packages. Change paths in this tree and [status.md](./status.md) before changing code.

```text
XRK-harness/
├── apps/
│   ├── cli/                 # @xrkseek/harness-cli
│   ├── web/                 # product-shell source; serve uses dist/
│   └── console/             # Face console (?console=1; maintainer tool, not product entry)
├── packages/
│   ├── client/              # shell client packages (paired with apps/web)
│   ├── kernel/ · protocol/ · compose/
│   ├── session/session-projection/  # projection state/view seam
│   ├── core/{agent,agent-loop,tools,session,system-prompt}/
│   ├── llm/{llm,openai-compatible,deepseek,replay,registry}/
│   ├── mcp/ · attachment/
│   ├── exec/{fs,subprocess,shell,sandbox,web,lsp,pty}/
│   ├── workspace/ · policy/ · code-runtime/ · web-runtime/
│   ├── server/{http,loader,host,config,face}/
│   ├── sdk/ · testkit/
│   └── …
├── presets/{minimal,harness,server}/
├── extensions/              # process plugin samples (tools / channels)
├── .agents/                 # workspace agent layer (inject + skills)
├── docs/                    # spec source of truth
└── scripts/
```

Session persistence (Host `XRK_SESSIONS_DIR`): `sessions.db` (WAL · schema v3 · physical `text-chunks` · FTS5 trigram) plus sidecar `subagents.json` · `goals.json`. ZIP export uses `toPackedJSONL` + `.jsonl.zst`.

Host agent-cache: root session Scope `agent:{id}`; Face-registered child sessions of a parent use `openSubagentRealm` (`subagent:{id}`).

Face wiring: `packages/server/face/src/wire/`. Projection driver: `@xrkseek/session-projection` (Face `projections/` carrier). Product-shell source is `apps/web` + `packages/client`; serve hosts `apps/web/dist` (after `web:build` + `client:bundle` + `web:assemble`). `apps/console` is Face verification only.
