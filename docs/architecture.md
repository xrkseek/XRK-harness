# 架构 / Architecture

> **读者 / Audience**：集成者 · 贡献者 · 维护者 / Integrators · Contributors · Maintainers

宿主 **仅 TypeScript（Node ≥26）**。会话真源为 append-only **session 事件**；agent loop / turn 状态短寿。

The host is **TypeScript-only (Node ≥26)**. The session source of truth is append-only **session events**; agent loop / turn state is short-lived.

## 决策（ADR） / Decisions (ADR)

| ADR | 决策 / Decision |
|-----|------|
| [0001](./adr/0001-typescript-only-host.md) | 仅 TypeScript 宿主 / TypeScript-only host |
| [0002](./adr/0002-no-embed-upstream.md) | 内核本仓实现；外壳 MIT 二次创作（非 GitHub Fork） / In-repo kernel; MIT shell remix (not a GitHub Fork) |
| [0003](./adr/0003-session-long-loop-short.md) | Session 长寿 · Loop 短寿 / Session long-lived · Loop short-lived |
| [0004](./adr/0004-no-effect-runtime.md) | 无代数效应运行时内核 / No algebraic-effect runtime kernel |
| [0005](./adr/0005-compose-leaf.md) | 组合叶包 `@xrkseek/compose` / Composition leaf `@xrkseek/compose` |

## 文档分层 / Documentation Layers

完整身份与写作标准见 [audiences.md](./audiences.md)。摘要：

Full audience and writing standards: [audiences.md](./audiences.md). Summary:

| 层 / Layer | 形态 / Form | 写什么 / Include | 不写什么 / Exclude |
|----|------|--------|----------|
| 根 README · `docs/*` · 包 README · ADR | **教科书 / Textbook** | 产品、契约、用法、能力边界 / Product, contracts, usage, capability bounds | 发版口令当用户 FAQ、Agent 红线 / Release commands as user FAQ; Agent red lines |
| [maintainer](./maintainer.md) · [publishing](./publishing.md) | 教科书（**维护者专章**） / Textbook (**maintainer chapters**) | 交接、发版 / Handoff, release | 塞进根 README 正文 / Dump into root README body |
| [AGENTS.md](../AGENTS.md) · `.cursor/rules` · `.cursor/skills` | **笔记 / Notes** | 角色、红线、改哪测哪 / Roles, red lines, what to change/test | 假 API 当规格 / Fake APIs as specs |
| Canvas（本机） / Canvas (local) | **草稿 / Draft** | 对照 · 临时 TODO / Local contrasts · temporary TODOs | 入库 / Commit to the repo |

依赖边见 [AGENTS.md](../AGENTS.md)。能力矩阵：[status.md](./status.md)。交接：[maintainer.md](./maintainer.md)。

Dependency edges: [AGENTS.md](../AGENTS.md). Capability matrix: [status.md](./status.md). Handoff: [maintainer.md](./maintainer.md).

## 包平面 / Package Planes

```text
┌─────────────────────────────────────────────────────────┐
│  apps/cli · apps/web（壳 / shell）· apps/console（验证台 / console） │
│  packages/client（壳客户端包底稿 / shell client packages）           │
├─────────────────────────────────────────────────────────┤
│  presets: minimal | harness | server   ← 只组合，无业务 / compose only │
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

## 仓库树（与落盘对齐） / Repository Tree (On-Disk Layout)

33 个 `@xrkseek/*` 库包。改路径先改本树与 [status.md](./status.md)，再改代码。

Thirty-three `@xrkseek/*` library packages. Change paths in this tree and [status.md](./status.md) before changing code.

```text
XRK-harness/
├── apps/
│   ├── cli/                 # @xrkseek/harness-cli
│   ├── web/                 # 产品壳（二次创作源码；serve 用 dist/） / product shell (remix source; serve uses dist/)
│   └── console/             # Face 验证台（?console=1；维护者工具，非产品入口） / Face console (?console=1; maintainer tool, not product entry)
├── packages/
│   ├── client/              # 壳客户端包（与 apps/web 成对） / shell client packages (paired with apps/web)
│   ├── kernel/ · protocol/ · compose/
│   ├── session/session-projection/  # 投影状态/视图缝 / projection state/view seam
│   ├── core/{agent,agent-loop,tools,session,system-prompt}/
│   ├── llm/{llm,openai-compatible,deepseek,replay,registry}/
│   ├── mcp/ · attachment/
│   ├── exec/{fs,subprocess,shell,sandbox,web,lsp,pty}/
│   ├── workspace/ · policy/ · code-runtime/ · web-runtime/
│   ├── server/{http,loader,host,config,face}/
│   ├── sdk/ · testkit/
│   └── …
├── presets/{minimal,harness,server}/
├── extensions/              # 进程插件样例（tools / channels） / process plugin samples
├── templates/office-agent/  # workspace.syncSeeds 种子 / workspace.syncSeeds templates
├── examples/hello-agent/
├── docs/                    # 规格真源；无 docs/learn/ 目录 / spec source of truth; no docs/learn/ directory
└── scripts/
```

会话持久化（Host `XRK_SESSIONS_DIR`）：`sessions.db`（WAL · schema v3 · 物理 `text-chunks` · FTS5 trigram）+ 旁路 `subagents.json` · `goals.json`。ZIP 导出 `toPackedJSONL` + `.jsonl.zst`。

Session persistence (Host `XRK_SESSIONS_DIR`): `sessions.db` (WAL · schema v3 · physical `text-chunks` · FTS5 trigram) plus sidecar `subagents.json` · `goals.json`. ZIP export uses `toPackedJSONL` + `.jsonl.zst`.

Host agent-cache：根会话 Scope `agent:{id}`；Face 已登记父会话的子会话走 `openSubagentRealm`（`subagent:{id}`）。

Host agent-cache: root session Scope `agent:{id}`; Face-registered child sessions of a parent use `openSubagentRealm` (`subagent:{id}`).

Face 接线：`packages/server/face/src/wire/`。投影驱动：`@xrkseek/session-projection`（Face `projections/` 载体）。产品壳源码 `apps/web` + `packages/client`；serve 托管 `apps/web/dist`（先 `web:build` + `client:bundle` + `web:assemble`）。`apps/console` 仅作 Face 验证台。

Face wiring: `packages/server/face/src/wire/`. Projection driver: `@xrkseek/session-projection` (Face `projections/` carrier). Product-shell source is `apps/web` + `packages/client`; serve hosts `apps/web/dist` (after `web:build` + `client:bundle` + `web:assemble`). `apps/console` is Face verification only.
